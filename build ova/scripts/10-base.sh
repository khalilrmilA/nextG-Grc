#!/usr/bin/env bash
# Base runtime layer.
#
# The API is Python (FastAPI), so the runtime this installs is Python, not
# Node. Node is still installed because the React dashboard has to be built
# from source inside the guest; 25-protect-app.sh removes it again once the
# static bundle exists.
#
# The database is SQLite, held at /var/lib/appliance/grc.db. PostgreSQL is
# deliberately not installed: DATABASE_URL is written to the environment file
# at first boot, so pointing a deployment at an external PostgreSQL, Oracle or
# SQL Server later needs a configuration change, not a new image.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
NODE_MAJOR=22

# vmware | hyperv | azure. Decides the guest integration tooling, and is carried
# through to 35-lockdown.sh, firstboot.sh and 99-seal.sh.
TARGET="${APPLIANCE_TARGET:-vmware}"
case "${TARGET}" in
  vmware|hyperv|azure) ;;
  *) echo "[10-base] FATAL: unknown APPLIANCE_TARGET '${TARGET}'" >&2; exit 1 ;;
esac
echo "[10-base] target: ${TARGET}"

# ---------------------------------------------------------------------------
# Stop package maintainer scripts restarting services during the build.
#
# "apt-get upgrade" pulls new openssh-server, netplan.io, cloud-init and
# systemd. Their postinst scripts restart sshd and re-apply the network
# configuration, which tears down the very SSH connection the build is being
# driven over. Packer then fails with:
#
#   Script disconnected unexpectedly.
#
# An invoke-rc.d policy returning 101 means "do not run this action", so
# packages are unpacked and configured but nothing is restarted. 99-seal.sh
# removes the shim before the image is sealed, so a deployed appliance behaves
# normally again.
# ---------------------------------------------------------------------------
echo "[10-base] blocking service restarts for the duration of the build"
cat > /usr/sbin/policy-rc.d <<'EOF'
#!/bin/sh
# Installed by 10-base.sh during the image build; removed by 99-seal.sh.
exit 101
EOF
chmod 0755 /usr/sbin/policy-rc.d

# --force-confold keeps the existing config file when a package ships a new
# one, so an upgrade cannot silently replace something a later stage relies on
# and cannot stop to ask about it.
APT_OPTS="-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -o Acquire::Retries=3"

echo "[10-base] updating package index"
apt-get update

# APPLIANCE_FAST=1 skips the full upgrade. It is roughly ten minutes of network
# for security patches that matter only in a shipped image, so it is exactly the
# wrong thing to pay for when iterating on firstboot or the console.
#
# A fast image is NOT shippable: it carries whatever patch level the ISO had.
# 20-app.sh records FAST=1 in /etc/appliance/version so such an image can be
# identified after the fact, and 99-seal.sh refuses to seal one silently.
if [ "${APPLIANCE_FAST:-0}" = "1" ]; then
  echo "[10-base] FAST build: skipping apt-get upgrade (NOT shippable)"
else
  # shellcheck disable=SC2086  # APT_OPTS is several arguments and must word-split
  apt-get -y ${APT_OPTS} upgrade
fi

echo "[10-base] installing base packages"
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg openssl \
  nginx \
  ufw fail2ban \
  jq

echo "[10-base] installing guest integration for ${TARGET}"
case "${TARGET}" in
  vmware)
    # Provides vmtoolsd, which firstboot.sh uses to read the vApp properties
    # vCenter passes in through the guestInfo transport.
    apt-get install -y --no-install-recommends open-vm-tools
    ;;
  hyperv)
    # hv_kvp_daemon, hv_vss_daemon and hv_fcopy_daemon. The hv_* kernel modules
    # are already built into Ubuntu's kernel; these are the userspace halves
    # that let the host report the guest's IP and take consistent backups.
    # Hyper-V has no equivalent of vApp properties, so firstboot.sh falls back
    # to DHCP and the console menu is the way to set a static address.
    apt-get install -y --no-install-recommends \
      linux-tools-virtual linux-cloud-tools-virtual
    systemctl enable hv-kvp-daemon.service 2>/dev/null || true
    systemctl enable hv-vss-daemon.service 2>/dev/null || true
    ;;
  azure)
    # The Azure Linux Agent provisions the image: it creates the admin user,
    # applies the SSH key and reports readiness. 99-seal.sh deprovisions it so
    # each deployment gets its own identity.
    apt-get install -y --no-install-recommends walinuxagent cloud-init
    systemctl enable walinuxagent.service 2>/dev/null || true
    ;;
esac

echo "[10-base] installing the Python runtime"
# Ubuntu 24.04 ships Python 3.12, which is what backend/pyproject.toml requires.
apt-get install -y --no-install-recommends \
  python3 python3-venv python3-dev python3-pip \
  libffi-dev libssl-dev

echo "[10-base] installing the compile toolchain (removed again in 35-lockdown)"
# Nuitka compiles the application to C. These are build-time only.
apt-get install -y --no-install-recommends \
  build-essential patchelf ccache

echo "[10-base] installing OCR support"
# app/services/ocr_service.py shells out to tesseract and poppler. Without
# these the Document Capture feature fails at runtime with an unhelpful error
# rather than at build time. The Amiri font is what renders the Arabic
# text-reflow PDF; requirements.txt documents the same list.
apt-get install -y --no-install-recommends \
  tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra tesseract-ocr-ara \
  poppler-utils fonts-hosny-amiri

echo "[10-base] installing Node.js ${NODE_MAJOR}.x (build-time only)"
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node --version

echo "[10-base] creating the application account"
id -u appliance >/dev/null 2>&1 || \
  useradd --system --create-home --home-dir /var/lib/appliance \
          --shell /usr/sbin/nologin appliance

install -d -m 0750 -o appliance -g appliance /var/lib/appliance
install -d -m 0750 -o appliance -g appliance /var/lib/appliance/uploads
install -d -m 0750 -o root -g appliance /etc/appliance
install -d -m 0750 -o root -g appliance /etc/appliance/tls
install -d -m 0750 -o appliance -g appliance /var/log/appliance

echo "[10-base] disabling services that must not run before firstboot"
systemctl disable --now nginx || true

echo "[10-base] done"
