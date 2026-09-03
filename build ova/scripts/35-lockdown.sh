#!/usr/bin/env bash
# Lock the appliance down: no interactive shell, no boot-time shell escape,
# no debugger, no toolchain, no writable executable paths.
#
# Runs after 30-harden.sh and before 99-seal.sh.
#
# What this script deliberately does NOT do any more: disable and mask SSH.
# That was defect 2. The build is driven over SSH and 99-seal.sh still has to
# run after this script, so masking here killed the build before the image was
# ever sealed. SSH is now shut down by appliance-ssh-lockdown.service, which
# runs on the customer's first boot, and 99-seal.sh masks it as its own final
# action for the case where the image is booted without that unit.
set -euo pipefail

GRUB_USER="${GRUB_USER:-svcadmin}"
BUILD_USER="${BUILD_USER:-builder}"
TARGET="${APPLIANCE_TARGET:-vmware}"

# Azure deliberately gets a weaker profile, and it is worth being explicit about
# why rather than discovering it during a support case:
#
#   - Boot diagnostics and serial console recovery need a real login on ttyS0.
#     Masking it, as the vmware and hyperv profiles do, means an appliance that
#     fails to boot in Azure cannot be diagnosed at all.
#   - The Azure Linux Agent provisions the administrator account at deploy time,
#     so locking every interactive account at build time breaks provisioning.
#   - A GRUB password with GRUB_TIMEOUT=0 makes serial console recovery
#     impossible, which is the only recovery path Azure offers.
#
# Everything else (ptrace_scope, no core dumps, mount options, AppArmor,
# toolchain removal, execute-only binary) applies to all three targets.
if [ "${TARGET}" = "azure" ]; then
  echo "[35-lockdown] target azure: serial console and agent provisioning kept"
  GRUB_PASSWORD="${GRUB_PASSWORD:-}"
else
  # Passed in from the build, never a literal in the repository.
  GRUB_PASSWORD="${GRUB_PASSWORD:?set GRUB_PASSWORD in the build environment}"
fi

# ---------------------------------------------------------------------------
echo "[35-lockdown] replacing the console with a restricted menu"
install -d -m 0755 /opt/appliance/bin
install -m 0755 /tmp/files/console/appliance-console.sh /opt/appliance/bin/console

# tty1 runs the menu instead of a login prompt.
install -d -m 0755 /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=-/opt/appliance/bin/console
StandardInput=tty
StandardOutput=tty
Restart=always
EOF

# The remaining virtual terminals get nothing at all.
systemctl mask getty@tty2.service getty@tty3.service getty@tty4.service \
               getty@tty5.service getty@tty6.service 2>/dev/null || true

if [ "${TARGET}" = "azure" ]; then
  # Azure boot diagnostics and the serial console both depend on this. It is
  # the only remote recovery path Azure offers for a guest that will not boot.
  systemctl enable serial-getty@ttyS0.service 2>/dev/null || true
else
  systemctl mask serial-getty@ttyS0.service 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
echo "[35-lockdown] removing interactive accounts"
# Lock every human account except the build user, which 99-seal.sh deals with
# after it has finished running over SSH. Locking it here would break the
# remaining provisioning steps.
if [ "${TARGET}" = "azure" ]; then
  # walinuxagent creates the administrator at deploy time, after 99-seal.sh has
  # deprovisioned the image. Locking accounts here would break that.
  echo "[35-lockdown] azure: leaving interactive accounts to the Azure agent"
  passwd -l root
else
  while IFS= read -r u; do
    if [ "$u" = "${BUILD_USER}" ]; then
      echo "[35-lockdown] leaving ${u} until 99-seal.sh"
      continue
    fi
    usermod -s /usr/sbin/nologin -L "$u"
  done < <(awk -F: '$3 >= 1000 && $3 < 65534 {print $1}' /etc/passwd)
  passwd -l root
  usermod -s /usr/sbin/nologin root
fi

# SSH itself is left running here on purpose. See the header.

# ---------------------------------------------------------------------------
if [ "${TARGET}" = "azure" ]; then
  echo "[35-lockdown] GRUB serial console (Azure boot diagnostics)"
  # Azure captures the serial console for boot diagnostics. Without these the
  # console is blank and a failed boot is undiagnosable. rootdelay covers slow
  # storage attach on first boot.
  sed -i 's|^GRUB_CMDLINE_LINUX=.*|GRUB_CMDLINE_LINUX="console=tty1 console=ttyS0 earlyprintk=ttyS0 rootdelay=300"|' /etc/default/grub
  grep -q '^GRUB_CMDLINE_LINUX=' /etc/default/grub || \
    echo 'GRUB_CMDLINE_LINUX="console=tty1 console=ttyS0 earlyprintk=ttyS0 rootdelay=300"' >> /etc/default/grub
  sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=5/' /etc/default/grub
  # Quoted, and it matters: grub-mkconfig SOURCES this file as a shell script.
  # Unquoted, "GRUB_TERMINAL=serial console" is parsed as an assignment followed
  # by a command named "console", and grub-mkconfig dies with
  #   /etc/default/grub: console: not found
  # exiting 127. That killed an Azure build 73 minutes in.
  grep -q '^GRUB_TERMINAL=' /etc/default/grub || \
    echo 'GRUB_TERMINAL="serial console"' >> /etc/default/grub
  grep -q '^GRUB_SERIAL_COMMAND=' /etc/default/grub || \
    echo 'GRUB_SERIAL_COMMAND="serial --speed=115200 --unit=0 --word=8 --parity=no --stop=1"' >> /etc/default/grub

  # /etc/default/grub is SOURCED by grub-mkconfig, so a quoting mistake here
  # surfaces as an error blaming grub rather than the line we just wrote. Check
  # it ourselves and say plainly what is wrong.
  # SOURCE it, do not merely syntax-check it. "sh -n" accepts
  #   GRUB_TERMINAL=serial console
  # because that IS valid shell: an assignment followed by a command. The
  # failure only appears when the file is executed and "console" turns out not
  # to be a command, which is exactly what grub-mkconfig does and exactly the
  # 127 that killed a build. Sourcing in a subshell reproduces that here, where
  # the error can name the real cause.
  # shellcheck source=/dev/null disable=SC1091
  if ! ( set -e; . /etc/default/grub ) >/dev/null 2>/tmp/grubcheck.err; then
    echo "[35-lockdown] FATAL: /etc/default/grub fails when sourced," >&2
    echo "[35-lockdown] which is what grub-mkconfig does to it:" >&2
    sed 's/^/  /' /tmp/grubcheck.err >&2
    echo "[35-lockdown] current GRUB_ settings:" >&2
    grep -n 'GRUB_' /etc/default/grub >&2
    exit 1
  fi
  update-grub
else
  echo "[35-lockdown] GRUB password"
  # Without this, anyone can append init=/bin/bash at the boot menu and get root
  # with no password at all, which defeats every account lock above.
  HASH="$(printf '%s\n%s\n' "${GRUB_PASSWORD}" "${GRUB_PASSWORD}" \
          | grub-mkpasswd-pbkdf2 | awk '/grub.pbkdf2/ {print $NF}')"
  if [ -z "${HASH}" ]; then
    echo "[35-lockdown] FATAL: grub-mkpasswd-pbkdf2 produced no hash" >&2
    exit 1
  fi
  cat > /etc/grub.d/40_custom <<EOF
#!/bin/sh
exec tail -n +3 \$0
set superusers="${GRUB_USER}"
password_pbkdf2 ${GRUB_USER} ${HASH}
EOF
  chmod 755 /etc/grub.d/40_custom

  # Let the default entry boot unattended; only editing it requires the password.
  sed -i 's/^CLASS="/CLASS="--unrestricted /' /etc/grub.d/10_linux

  # No boot menu delay, no recovery entry to select.
  sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=0/' /etc/default/grub
  sed -i 's/^#\?GRUB_DISABLE_RECOVERY=.*/GRUB_DISABLE_RECOVERY="true"/' /etc/default/grub
  grep -q GRUB_DISABLE_RECOVERY /etc/default/grub || \
    echo 'GRUB_DISABLE_RECOVERY="true"' >> /etc/default/grub
  update-grub
fi

# ---------------------------------------------------------------------------
echo "[35-lockdown] blocking live memory inspection"
cat > /etc/sysctl.d/99-lockdown.conf <<'EOF'
# 3 disables ptrace entirely and cannot be lowered without a reboot. Without
# this, a shell can attach a debugger to the running service and read the
# decompiled application and every secret straight out of its memory.
kernel.yama.ptrace_scope = 3
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.unprivileged_bpf_disabled = 1
fs.suid_dumpable = 0
kernel.core_pattern = |/bin/false
EOF

cat > /etc/security/limits.d/99-nocore.conf <<'EOF'
* hard core 0
* soft core 0
EOF
mkdir -p /etc/systemd/coredump.conf.d
printf '[Coredump]\nStorage=none\nProcessSizeMax=0\n' \
  > /etc/systemd/coredump.conf.d/99-disable.conf

# ---------------------------------------------------------------------------
echo "[35-lockdown] mount options"
# noexec on writable paths, and no execution from removable media.
cp /etc/fstab /etc/fstab.orig
cat >> /etc/fstab <<'EOF'
tmpfs   /tmp        tmpfs   defaults,rw,nosuid,nodev,noexec,relatime,size=512M  0 0
tmpfs   /var/tmp    tmpfs   defaults,rw,nosuid,nodev,noexec,relatime,size=256M  0 0
tmpfs   /dev/shm    tmpfs   defaults,rw,nosuid,nodev,noexec,relatime           0 0
EOF

cat > /etc/modprobe.d/99-lockdown.conf <<'EOF'
install usb-storage /bin/false
install firewire-core /bin/false
install cramfs /bin/false
install freevxfs /bin/false
install jffs2 /bin/false
install hfsplus /bin/false
install udf /bin/false
EOF

# ---------------------------------------------------------------------------
echo "[35-lockdown] removing the toolchain"
# python3 is NOT in this list on purpose. Ubuntu's netplan command line tool is
# Python, and firstboot.sh reconfigures the network through it, so purging the
# interpreter would leave the appliance unable to get an address.
apt-get -y purge \
  npm build-essential gcc g++ make cpp \
  git git-man patch dpkg-dev \
  gdb strace ltrace tcpdump netcat-openbsd telnet \
  patchelf ccache \
  python3-dev libffi-dev libssl-dev \
  wget 2>/dev/null || true
apt-get -y autoremove --purge
rm -rf /usr/include /usr/share/man /usr/share/doc /root/.npm /root/.cache

# Package management stays for the vendor's own signed updates, but not for the
# customer.
chmod 0700 /usr/bin/apt /usr/bin/apt-get /usr/bin/dpkg 2>/dev/null || true

# Confirm the toolchain purge did not take the interpreter or netplan with it.
for required in /usr/bin/python3 /usr/sbin/netplan /usr/sbin/nginx; do
  if [ ! -e "${required}" ]; then
    echo "[35-lockdown] FATAL: ${required} was removed; the appliance cannot boot" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
echo "[35-lockdown] AppArmor profile for the service"
cat > /etc/apparmor.d/opt.appliance.runtime <<'EOF'
abi <abi/3.0>,
include <tunables/global>

/opt/appliance/runtime/appliance-api {
  include <abstractions/base>
  include <abstractions/nameservice>
  include <abstractions/openssl>
  include <abstractions/python>

  network inet stream,
  network inet6 stream,

  # The compiled application and the shared objects it loads beside itself.
  #
  # The DIRECTORY entries matter as much as their contents, for the same reason
  # spelled out for /var/lib/appliance below: a '**' rule matches paths under a
  # directory but never the directory itself. importlib.resources enumerates a
  # package's own directory to locate the data files it ships, so without read
  # on the entry, any package that resolves its data that way fails to import.
  # Observed as a bare ImportError out of certifi/core.py with this beside it:
  #   apparmor="DENIED" operation="open" name="/opt/appliance/runtime/"
  /opt/appliance/runtime/ r,
  /opt/appliance/runtime/** mr,
  /opt/appliance/frameworks/ r,
  /opt/appliance/frameworks/** r,
  /opt/appliance/seed/ r,
  /opt/appliance/seed/** r,
  /etc/appliance/app.env r,
  /etc/appliance/version r,
  /etc/appliance/support.pub r,
  # support-verify rebuilds the challenge from the machine id, so it must be
  # readable or every support response is rejected as "not one this appliance
  # issued" - a denial that looks exactly like a bad signature.
  /etc/machine-id r,
  # openpyxl imports mimetypes, whose module-level init reads this. Denying it
  # raises PermissionError during import of the Excel export module, which is
  # reached from app/api/v1/router.py, so the whole API failed to start.
  /etc/mime.types r,
  /etc/timezone r,
  /etc/localtime r,
  /usr/share/zoneinfo/** r,
  # The directory itself, not only its contents: SQLite creates -journal
  # and -wal files beside the database, which needs write on the DIRECTORY.
  # "/var/lib/appliance/**" matches paths under it but not the entry itself.
  /var/lib/appliance/ rw,
  /var/lib/appliance/** rwk,
  /var/log/appliance/** rw,
  /proc/sys/kernel/random/uuid r,
  # Read during import by cryptography and by the async runtime at startup.
  # Traced from the real binary, not guessed.
  /proc/sys/crypto/fips_enabled r,
  /proc/sys/vm/overcommit_memory r,
  @{PROC}/version_signature r,
  # Read by the runtime to size default thread pools from the cgroup limits.
  # Denied during the rehearsal on every run. Both paths are needed: the
  # process learns WHICH cgroup it is in from /proc, then reads the limits
  # themselves from the cgroup filesystem.
  @{PROC}/@{pid}/cgroup r,
  /sys/fs/cgroup/ r,
  /sys/fs/cgroup/** r,

  # Document Capture shells out to these. The scaffold's blanket
  # "deny /usr/bin/** x" silently disabled OCR, because in AppArmor an explicit
  # deny beats an allow, so the specific binaries have to be permitted and the
  # deny narrowed to shells and interpreters.
  /usr/bin/tesseract ix,
  /usr/bin/pdftoppm ix,
  /usr/bin/pdfinfo ix,
  /usr/bin/pdftotext ix,
  /usr/share/tesseract-ocr/** r,
  /usr/share/tessdata/** r,
  # The directory entry as well as its contents. A '**' rule matches paths
  # under a directory but never the directory itself, which is the same trap
  # that broke /opt/appliance/runtime/ and /var/lib/appliance/.
  /usr/share/fonts/ r,
  /usr/share/fonts/** r,

  deny /etc/shadow rwx,
  deny /root/** rwx,
  deny /home/** rwx,
  deny /opt/appliance/runtime/** w,
  deny @{PROC}/*/mem rwx,

  # No shell, no interpreter, no package manager from inside the service.
  deny /bin/dash x,
  deny /bin/bash x,
  deny /bin/sh x,
  deny /usr/bin/bash x,
  deny /usr/bin/dash x,
  deny /usr/bin/sh x,
  deny /usr/bin/python3* x,
  deny /usr/bin/perl x,
  deny /usr/bin/apt* x,
  deny /usr/bin/dpkg x,
}
EOF
if ! apparmor_parser -r /etc/apparmor.d/opt.appliance.runtime 2>/dev/null; then
  echo "[35-lockdown] WARN: apparmor profile not loaded, check it manually"
fi

# ---------------------------------------------------------------------------
# Prove the application still runs now that the profile is loaded.
#
# This check exists because of a real failure: the build-time smoke test in
# 25-protect-app.sh passed, and the appliance then died on the customer's first
# boot with
#
#   ImportError: /opt/appliance/runtime/_contextvars.so:
#                cannot open shared object file: Permission denied
#
# AppArmor denies every capability it does not grant, so the confined process
# lost CAP_DAC_OVERRIDE and could no longer read files whose owner had no
# permissions. Nothing before this point could have caught it, because the
# profile did not exist yet. Verify here, where it does.
APPBIN=/opt/appliance/runtime/appliance-api
if [ -x "${APPBIN}" ]; then
  echo "[35-lockdown] rehearsing the first-boot sequence under AppArmor"

  # Rehearse what firstboot ACTUALLY does, not just "does the binary start".
  #
  # The first version of this check ran only "version", which touches no
  # database, no uploads and no state directory. It passed, and the appliance
  # then died on the customer's first boot with:
  #
  #   sqlalchemy.exc.OperationalError: unable to open database file
  #
  # Each firstboot failure aborts at the FIRST error, so an enforcing profile
  # reveals exactly one missing permission per boot. Exercising the real
  # sequence here surfaces them all in one build instead of one per rebuild.
  REHEARSE=/var/lib/appliance/.rehearse
  rm -rf "${REHEARSE}"
  install -d -m 0750 -o appliance -g appliance "${REHEARSE}"
  cp /opt/appliance/seed/grc_seed.db "${REHEARSE}/db" 2>/dev/null || true
  chown appliance:appliance "${REHEARSE}/db" 2>/dev/null || true
  chmod 0640 "${REHEARSE}/db" 2>/dev/null || true

  rehearse() {
    runuser -u appliance -- env \
      ENVIRONMENT=production DEBUG=false \
      SECRET_KEY=rehearsal-only-not-a-real-secret-0123456789abcdef \
      DATABASE_URL="sqlite+aiosqlite:///${REHEARSE}/db" \
      UPLOADS_DIR="${REHEARSE}" \
      APPLIANCE_STATE_DIR=/var/lib/appliance \
      "${APPBIN}" "$@"
  }

  # ---------------------------------------------------------------------
  # Pass 1: COMPLAIN mode, purely to enumerate what is missing.
  #
  # In enforce mode the first denial aborts the run and hides everything
  # behind it, so each build reveals exactly one missing rule. At 75 minutes
  # a build that is unaffordable, and it has already cost several rounds.
  # In complain mode nothing is blocked and the kernel logs every access that
  # WOULD have been denied, so one build surfaces the complete list.
  #
  # This pass is advisory only. It never fails the build; the enforce pass
  # below is the gate.
  if command -v dmesg >/dev/null 2>&1; then dmesg -C >/dev/null 2>&1 || true; fi
  if apparmor_parser -r -C /etc/apparmor.d/opt.appliance.runtime 2>/dev/null; then
    echo "[35-lockdown] complain-mode pass: enumerating every missing permission"
    rehearse version      >/dev/null 2>&1 || true
    rehearse migrate      >/dev/null 2>&1 || true
    rehearse prepare-seed >/dev/null 2>&1 || true
    rehearse create-admin --email complain@appliance.local --generate \
            --password-out "${REHEARSE}/pass.complain" >/dev/null 2>&1 || true
    rehearse serve --host 127.0.0.1 --port 18098 >/dev/null 2>&1 &
    COMPLAIN_PID=$!
    for _ in $(seq 1 30); do
      curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:18098/health" 2>/dev/null && break
      kill -0 "${COMPLAIN_PID}" 2>/dev/null || break
      sleep 2
    done
    kill "${COMPLAIN_PID}" 2>/dev/null || true
    wait "${COMPLAIN_PID}" 2>/dev/null || true
    pkill -u appliance -f 'appliance-api serve' 2>/dev/null || true

    if command -v dmesg >/dev/null 2>&1; then
      WANTED="$(dmesg 2>/dev/null \
        | grep -E 'apparmor="(ALLOWED|DENIED)"' \
        | grep 'appliance-api' \
        | grep -o 'name="[^"]*"' | sed 's/name="//; s/"$//' \
        | sort -u || true)"
      if [ -n "${WANTED}" ]; then
        echo "[35-lockdown] paths the profile does not currently allow:"
        printf '%s\n' "${WANTED}" | sed 's|^|[35-lockdown]     |'
        echo "[35-lockdown] add the ones that are legitimate to the profile above."
      else
        echo "[35-lockdown] complain-mode pass found nothing missing"
      fi
      dmesg -C >/dev/null 2>&1 || true
    fi
  fi

  # Pass 2: ENFORCE mode. This one is the gate.
  if ! apparmor_parser -r /etc/apparmor.d/opt.appliance.runtime 2>/dev/null; then
    echo "[35-lockdown] WARN: could not reload the profile in enforce mode" >&2
  fi
  REHEARSAL_FAILED=0
  for step in version migrate prepare-seed; do
    if ! rehearse "${step}" >/dev/null 2>&1; then
      echo "[35-lockdown] FATAL: '${step}' fails under the AppArmor profile" >&2
      rehearse "${step}" >&2 || true
      REHEARSAL_FAILED=1
      break
    fi
    echo "[35-lockdown]   ${step}: ok"
  done

  if [ "${REHEARSAL_FAILED}" -eq 0 ]; then
    if rehearse create-admin --email rehearsal@appliance.local --generate \
         --password-out "${REHEARSE}/pass" >/dev/null 2>&1; then
      echo "[35-lockdown]   create-admin: ok"
      # The SUPER admin path too. firstboot.sh creates a second account with
      # --role super_admin, and nothing else in this build exercises it, so a
      # bug there would first appear on a customer's first boot.
      if rehearse create-admin --email superrehearsal@appliance.lan            --role super_admin --generate            --password-out "${REHEARSE}/pass.super" >/dev/null 2>&1; then
        echo "[35-lockdown]   create-admin --role super_admin: ok"
      else
        echo "[35-lockdown] FATAL: 'create-admin --role super_admin' fails" >&2
        rehearse create-admin --email superrehearsal@appliance.lan           --role super_admin --generate           --password-out "${REHEARSE}/pass.super" >&2 || true
        REHEARSAL_FAILED=1
      fi
    else
      echo "[35-lockdown] FATAL: 'create-admin' fails under the AppArmor profile" >&2
      rehearse create-admin --email rehearsal@appliance.local --generate \
        --password-out "${REHEARSE}/pass" >&2 || true
      REHEARSAL_FAILED=1
    fi
  fi

  # Rehearse "serve" too, and require that it actually answers.
  #
  # Everything above is a short lived CLI command, and not one of them imports
  # app.main. That module is where the FastAPI application, its middleware and
  # every third party integration get pulled in, so a build in which only the
  # CLI paths work still produces an appliance whose console cheerfully reports
  # "created admin" and whose web interface never comes up. That is exactly what
  # the first built OVA did:
  #
  #   appliance-api.service: Failed with result 'exit-code'   (restart loop)
  #   ImportError ... certifi/core.py line 51   (via sentry_sdk, via app.main)
  #
  # The CLI rehearsal passed that build. Only booting the server catches it.
  if [ "${REHEARSAL_FAILED}" -eq 0 ]; then
    SERVE_LOG="${REHEARSE}/serve.log"
    SERVE_PORT=18099
    rehearse serve --host 127.0.0.1 --port "${SERVE_PORT}" >"${SERVE_LOG}" 2>&1 &
    SERVE_PID=$!

    SERVE_OK=0
    for _ in $(seq 1 40); do
      if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${SERVE_PORT}/health" 2>/dev/null ||
         curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${SERVE_PORT}/" 2>/dev/null; then
        SERVE_OK=1
        break
      fi
      # If it has already exited there is nothing to wait for.
      kill -0 "${SERVE_PID}" 2>/dev/null || break
      sleep 2
    done

    # runuser forks, so killing the job alone can leave the server behind and
    # the port held. Take the process group and then sweep by name.
    kill "${SERVE_PID}" 2>/dev/null || true
    wait "${SERVE_PID}" 2>/dev/null || true
    pkill -u appliance -f 'appliance-api serve' 2>/dev/null || true

    if [ "${SERVE_OK}" -eq 1 ]; then
      echo "[35-lockdown]   serve: ok"
    else
      echo "[35-lockdown] FATAL: 'serve' never answered under the AppArmor profile" >&2
      echo "[35-lockdown] last 40 lines of its output:" >&2
      tail -40 "${SERVE_LOG}" >&2 2>/dev/null || true
      REHEARSAL_FAILED=1
    fi
  fi

  # Every denial the kernel logged, not just the one that aborted the run. This
  # is what turns "one bug per rebuild" into "all of them, now".
  if command -v dmesg >/dev/null 2>&1; then
    DENIALS="$(dmesg 2>/dev/null | grep -i 'apparmor="DENIED"' | tail -40 || true)"
    if [ -n "${DENIALS}" ]; then
      echo "[35-lockdown] AppArmor denials recorded during the rehearsal:" >&2
      printf '%s\n' "${DENIALS}" >&2
    fi
  fi

  rm -rf "${REHEARSE}"

  if [ "${REHEARSAL_FAILED}" -ne 0 ]; then
    echo "[35-lockdown] the appliance would not survive its first boot; failing the build" >&2
    exit 1
  fi
  echo "[35-lockdown] first-boot sequence rehearsed successfully"
fi

# ---------------------------------------------------------------------------
echo "[35-lockdown] file permissions"
# 0750 root:appliance, not 0700: the service user has to be able to traverse
# this directory to reach the files the AppArmor profile grants it. app.env
# stays 0640 so it is still unreadable to anyone else.
chown root:appliance /etc/appliance
chmod 0750 /etc/appliance
chmod 0644 /etc/appliance/version
[ -f /etc/appliance/support.pub ] && chmod 0644 /etc/appliance/support.pub
chmod 0700 /opt/appliance/bin
chmod 0750 /var/log/appliance
chmod 0750 /var/lib/appliance

echo "[35-lockdown] done"
