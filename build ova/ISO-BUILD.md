# Building the installer ISO

The OVA covers hypervisors. This covers **bare metal**, where an OVA is useless
because there is no hypervisor to import it into.

Both artefacts are built from the same source tree and run the **same
provisioning scripts**, so a fix made for one target applies to the other. The
only difference is when those scripts run.

---

## Which artefact do I give a customer?

| Customer says | Give them | Why |
|---|---|---|
| "We run VMware / ESXi / vCenter" | the **OVA** | Imports in one step with the right CPU, RAM, disk and NIC already described |
| "We run Hyper-V" | the **VHD** (`Convert-Disk.ps1`) | Hyper-V cannot read an OVA |
| "We deploy to Azure" | the **VHD** | Azure needs a fixed VHD |
| "Install it on this server in our rack" | the **ISO** | The only option with no hypervisor |
| "We want to install it ourselves, on our own VMs" | the **ISO** | Works on any hypervisor too, just with more steps |

An ISO is **not** a faster path on a hypervisor. The OVA carries the hardware
description, so importing it produces a correctly configured VM in one action.
An ISO carries none, so whoever boots it has to invent the CPU count, memory,
disk size, NIC type and firmware mode, and then sit through an install.

---

## Prerequisites

Windows ships no ISO authoring tool. `xorriso`, `mkisofs` and `genisoimage` are
all absent, and `oscdimg` only arrives with the 1.5 GB Windows ADK. The build
therefore runs inside WSL.

```powershell
# One time, if you do not already have it
wsl --install -d Ubuntu
```

`Build-Iso.ps1` installs `xorriso` inside the distribution on first run. It runs
WSL commands as `root`, because a default WSL user needs a sudo password that
cannot be supplied non-interactively.

You also need the stock **Ubuntu Server 24.04 live** ISO. Not the desktop image
and not the mini ISO: the payload is delivered through subiquity's autoinstall,
which only the live server image runs.

```powershell
curl.exe -L -o D:\iso\ubuntu-24.04.3-live-server-amd64.iso `
  https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso
```

---

## Building

```powershell
$env:SUPPORT_PUBLIC_KEY = 'ssh-ed25519 AAAA...'   # public half only
$env:LICENSE_PUBLIC_KEY = '<base64 ed25519 public key>'

cd "D:\GRC\build ova\scripts"
.\Build-Iso.ps1 -AppSource D:\GRC -Version 1.0.0
```

Roughly five to ten minutes. The result lands in `build ova\output\` with a
`.sha256` beside it.

### Options

| Parameter | Default | Notes |
|---|---|---|
| `-AppSource` | required | The repository root |
| `-Version` | `1.0.0` | Stamped into `/etc/appliance/version` |
| `-BaseIso` | `D:\iso\ubuntu-24.04.3-live-server-amd64.iso` | Stock Ubuntu Server ISO |
| `-Hostname` | `appliance` | Hostname the installed machine boots with |
| `-ProtectLevel` | `binary` | Same meaning as the OVA build |
| `-Distro` | `Ubuntu` | Which WSL distribution does the work |

---

## What the customer experiences

1. Boot the ISO (USB stick, iDRAC/iLO virtual media, or a VM's optical drive).
2. Pick the first menu entry. **It erases the target disk without asking again.**
3. Ubuntu installs unattended, then reboots.
4. `Preparing the appliance. This takes 40 to 60 minutes.` appears on the
   console, with per stage progress. **This step needs an internet connection.**
5. The machine reboots by itself.
6. The console shows the URL and the generated administrator password.

The appliance is ready after the **second** boot.

### Why it builds itself on the machine instead of shipping pre-built

The provisioning scripts need things an installer's chroot does not have:

- `30-harden.sh` runs `ufw --force enable`, which needs live netfilter
- `35-lockdown.sh` runs `apparmor_parser -r`, which needs `/sys/kernel/security`
- `35-lockdown.sh` rehearses the whole first-boot sequence under the loaded
  AppArmor profile and reads kernel denials back out of `dmesg`
- `25-protect-app.sh` smoke tests the compiled binary as a confined user

Running them on a real booted system means the ISO path executes byte for byte
the same scripts as the OVA path, with no chroot-specific variants to keep in
sync. That equivalence is the point.

The cost is the second boot and the internet requirement. See **Known limits**.

---

## What is deliberately not in the ISO

No credential. Every ISO handed out is byte identical, so anything literal in it
is a secret shared across the whole install base.

subiquity refuses to install without an identity, so one account has to exist.
It is given a 32 character random password that is generated during the build,
hashed, and never written down. `99-seal.sh` then replaces the hash with `!` at
the end of provisioning, so the finished appliance has no usable password hash
in `/etc/shadow` at all.

The build fails outright if a string containing `PRIVATE KEY` reaches
`build.env`, and the staging audit refuses to continue if a `.env`, a `.pem`, a
`.key`, `node_modules`, a `.git` directory, `uploads` or any database other than
the seed reaches the payload.

---

## How the remaster works

| Path on the ISO | What it is |
|---|---|
| `/nocloud/user-data` | Autoinstall config, rendered from `iso/user-data.tmpl` |
| `/nocloud/meta-data` | cloud-init instance metadata |
| `/appliance/` | The payload: app source tarball, the provisioning scripts, `build.env` |
| `/boot/grub/grub.cfg` | Replaced boot menu |
| `/md5sum.txt` | Updated for the replaced boot menu |

Two details matter in the boot menu:

- **`autoinstall` on the kernel command line.** Without it subiquity stops and
  asks the operator to confirm before touching the disks. With it, that
  confirmation is suppressed, which is why the menu entry has to say plainly
  that it erases the disk.
- **`ds=nocloud\;s=/cdrom/nocloud/`.** The semicolon is escaped because GRUB
  otherwise reads it as a command separator, and the kernel would receive a
  truncated `ds=nocloud` that resolves to no seed at all.

The repack uses `xorriso -boot_image any replay`, which carries the original El
Torito catalogue, protective MBR, GPT and appended EFI system partition across
to the new image. Reconstructing those by hand from `-report_el_torito` output
is the usual approach and it is far easier to get subtly wrong; a mistake there
produces an ISO that boots on BIOS and silently fails on UEFI, or the reverse.
The build verifies both boot records survived before it reports success.

---

## Known limits

**It needs an internet connection during the first boot.** The provisioning run
installs apt, pip and npm packages and compiles the backend with Nuitka. For an
air-gapped customer, ship the OVA instead, or see the offline variant below.

**It takes 40 to 60 minutes on the customer's hardware,** against about two
minutes to import an OVA.

**If provisioning fails** the console prints the failing stage, the log path and
a recovery password generated on that machine. That credential exists only on a
build that already failed; a successful run never prints one. Reinstalling is
usually faster than repairing by hand.

### The offline variant, not built yet

The fast, air-gapped version ships the **already built** appliance disk inside
the ISO and has the installer write it to the target, rather than building on
the customer's machine. That is roughly a five minute install with no network at
all, and it is what most appliance vendors actually ship.

It is more machinery: the built root filesystem has to be extracted from the
OVA's disk, packed as a squashfs, and laid down by a custom installer step.
Worth doing when a customer needs air-gapped or fast installs; not needed for
the network-install case this ISO already covers.
