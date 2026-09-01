# Building the OVA on Windows

Yes, this works, and for an ESXi target it is the cleaner option: VMware
Workstation produces native VMware virtual hardware, so there is none of the
`virtualbox-2.2` descriptor patching the Linux path needs.

Your Ubuntu server is not involved at any point. You clone the repository on
Windows and build from source. The running server stays exactly as it is.

---

## Why the running server should not be the source anyway

It is worth being explicit about this, because it is the tempting shortcut.

An appliance built from a machine that has been running and administered for
months inherits everything on it: shell history, SSH known_hosts and private
keys, npm and docker credentials, `.env` files, test data, whatever the last
person debugging at 2am left behind. Every customer who imports that OVA
receives a copy. Building from the repository is not just tidier, it is the only
version you can honestly attest to.

---

## Step 1. Install the tools

| Tool | Why | Where |
|---|---|---|
| VMware Workstation Pro | build hypervisor, and it bundles ovftool | Broadcom, free for commercial use since 2025 |
| Packer | drives the build | `winget install HashiCorp.Packer` |
| Git for Windows | clone the repo | `winget install Git.Git` |

`tar.exe` and `curl.exe` are already in Windows 10 and 11. Confirm:

```powershell
packer version
tar --version
& "C:\Program Files\VMware\VMware Workstation\OVFTool\ovftool.exe" --version
```

## Step 2. Deal with Hyper-V before you start

This is the one Windows-specific trap that costs real time.

Hyper-V, WSL2, Windows Sandbox, Docker Desktop with the WSL2 backend, and
Memory Integrity (Core Isolation) all claim the CPU virtualisation extensions.
Workstation 17 will still run alongside them using the Windows Hypervisor
Platform, but noticeably slower, and older versions fail outright.

Check what is active:

```powershell
Get-CimInstance Win32_ComputerSystem | Select-Object HypervisorPresent
bcdedit /enum | Select-String hypervisorlaunchtype
```

If you want full speed and can spare the reboot:

```powershell
# Run as Administrator. Reverse with "Auto" instead of "Off".
bcdedit /set hypervisorlaunchtype off
```

Then turn Memory Integrity off in Windows Security, Device security, Core
isolation. Reboot. Note that this disables WSL2 and Docker Desktop until you set
it back, so decide whether you would rather just accept the slower build.

## Step 3. Clone with the right line endings

This is the second Windows trap, and it is the one that actually breaks builds.

Git on Windows defaults to converting LF to CRLF on checkout. Every `.sh` file
in this repository then arrives in the Linux guest with `\r` at the end of the
shebang line, and the guest reports `bad interpreter: /usr/bin/env bash^M`,
which does not obviously point at line endings.

The `.gitattributes` in `build ova/` pins the endings for every script here,
so a fresh clone is safe. It is scoped to that directory on purpose: a repository
wide rule would renormalise the frontend and marketing trees as a side effect.

If you already cloned before it existed:

```powershell
git config core.autocrlf false
git rm --cached -r .
git reset --hard
```

The Packer template also runs `dos2unix` inside the guest as a second line of
defence, so a misconfigured workstation does not silently produce a broken
image. Belt and braces, deliberately.

## Step 4. Point the build at the Ubuntu ISO

Get the current ISO URL and its SHA256 from the Ubuntu releases page, then set
both in `packer/appliance-workstation.pkr.hcl`:

```hcl
variable "iso_url"      { default = "https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso" }
variable "iso_checksum" { default = "sha256:<paste from SHA256SUMS>" }
```

Packer downloads and caches it. Do not skip the checksum: it is the only thing
verifying that the base of your appliance is what Canonical published.

Also set the build password hash in `packer/http/user-data`. From WSL or any
Linux box:

```bash
mkpasswd -m sha-512 'your-build-password'
```

### If the ISO download times out

Packer aborts an ISO download that exceeds **30 minutes** with
`error downloading ISO: [context deadline exceeded]`. The deadline is not
configurable, so any link slower than roughly 1.7 MB/s will never finish a 3 GB
image no matter how many times you retry.

Fetch it once with a resumable downloader, verify it, and pass it in:

```powershell
curl.exe -L -C - -o C:\iso\ubuntu-24.04.3-live-server-amd64.iso `
  https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-live-server-amd64.iso

$h = (Get-FileHash C:\iso\ubuntu-24.04.3-live-server-amd64.iso -Algorithm SHA256).Hash.ToLower()
.\scripts\Build-Ova.ps1 -AppSource D:\GRC -Version 1.0.0 `
    -IsoUrl "file:///C:/iso/ubuntu-24.04.3-live-server-amd64.iso" `
    -IsoChecksum "sha256:$h"
```

`curl.exe -C -` resumes, so an interrupted download continues rather than
starting again. The checksum is still verified, so a corrupted resume fails the
build rather than producing a quietly wrong appliance.

## Step 5. Adapt the build to your application

Those files are already wired to this repository. What you supply are the
build-time credentials, taken from the environment so they never reach the
repository, the PowerShell history or a transcript:

```powershell
$env:BUILD_PASSWORD      = 'build-only-secret'
$env:BUILD_PASSWORD_HASH = '$6$...'   # mkpasswd -m sha-512, from WSL
$env:GRUB_PASSWORD       = 'grub-only-secret'
```

Verify the dashboard builds on your own checkout first. The API is Python and
has no build step; it is compiled inside the guest.

```powershell
cd D:\GRC\frontend ; npm ci ; npm run build ; dir dist
```

## Step 6. Run the build

```powershell
cd C:\src\appliance-build
.\scripts\Build-Ova.ps1 -AppSource D:\GRC -Version 1.0.0 -Headless $false
```

The first run is worth watching. Open
`packer/appliance-workstation.pkr.hcl` and set `headless = false` so the
Workstation window appears; the `boot_command` keystrokes are tied to the GRUB
menu of the specific ISO, and seeing them land (or not) saves a lot of guessing.
Set it back to `true` once it works.

Roughly 20 to 40 minutes, most of it the Ubuntu install and `npm ci`.

What the script does:

1. `packer build` creates the VM, installs Ubuntu unattended, normalises line
   endings, runs `10-base.sh`, `20-app.sh`, `25-protect-app.sh`,
   `30-harden.sh`, `35-lockdown.sh`, then `99-seal.sh`
2. `ovftool` exports the `.vmx` to a compressed OVA with the correct VMware
   hardware version
3. `Fix-OvaForEsxi.ps1` injects the vApp properties and the `guestInfo`
   transport, regenerates the manifest, repacks in the required order
4. writes `output\grceye-appliance-1.0.0.ova` and a `.sha256` beside it

## Step 7. Verify before you ship

```powershell
tar -tf output\grceye-appliance-1.0.0.ova
```

You should see the `.ovf` first, then the `.mf`, then the `.vmdk`. That ordering
is part of the OVA specification.

Then actually boot it. Import into Workstation:

```powershell
& "C:\Program Files\VMware\VMware Workstation\vmware.exe" -x output\grceye-appliance-1.0.0.ova
```

Watch the console. The firstboot service should run, then a banner should appear
with the URL and a generated admin password. Browse to it and log in.

Do not skip this. A broken `firstboot.sh` is invisible until someone powers the
appliance on, and if that someone is a customer, you find out by email.

## Step 8. Move the OVA off the machine

It is a single self-contained file.

```powershell
scp output\grceye-appliance-1.0.0.ova `
    output\grceye-appliance-1.0.0.ova.sha256 `
    user@target:/opt/images/
```

Verify on arrival:

```bash
sha256sum -c grceye-appliance-1.0.0.ova.sha256
```

USB drive, internal HTTP server or object storage all work equally well. Always
ship the checksum alongside it, and verify at the destination.

---

## What if you cannot install VMware Workstation

**VirtualBox for Windows** works too. Use `packer/appliance.pkr.hcl` as a
starting point with the `virtualbox-iso` builder, then run
`scripts\Fix-OvaForEsxi.ps1` with `-HardwareVersion vmx-15`; it rewrites the
`virtualbox-2.2` hardware family and strips the VirtualBox extension block, the
same as the Linux script does.

**Hyper-V** is not an option. It produces VHDX, has no OVA export path, and
conflicts with the other two hypervisors.

**WSL2 alone** is not enough either. You can run bash there, but the hypervisor
has to be a Windows application, so you would be calling `VBoxManage.exe` across
the WSL boundary with path translation on every argument. Packer on Windows
avoids that entirely.
