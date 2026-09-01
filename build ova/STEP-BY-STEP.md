# Building the OVA on your own Ubuntu machine, step by step

No vCenter, no ESXi, no CI server. Everything happens on the Ubuntu box you
already have. VirtualBox is used only as a throwaway build hypervisor; the OVA
it produces is patched so ESXi and vCenter accept it.

There are two ways to do this. Read the choice below before running anything.

---

## Choose your approach first

**Option A: build a fresh guest VM (recommended).**
A clean Ubuntu VM is created on your machine, your application is installed into
it, the image is sealed, then exported. Reproducible, no leftovers from your
development box, and you can rebuild version 1.0.1 tomorrow with one command.

**Option B: convert the running machine itself (P2V).**
Faster the first time, but it drags along everything on that machine: your dev
tools, shell history, SSH keys, cached credentials, test data. For an appliance
you hand to a customer, that is a data leak waiting to happen and it is not
reproducible. Use it only for a throwaway internal demo. Steps are at the bottom.

The rest of this document is Option A.

---

## Step 1. Install the build tools on your Ubuntu machine

```bash
sudo apt update
sudo apt install -y virtualbox qemu-utils cloud-image-utils rsync curl tar python3
```

Add yourself to the `vboxusers` group and log out and back in:

```bash
sudo usermod -aG vboxusers "$USER"
```

Check that the kernel modules loaded:

```bash
VBoxManage --version
lsmod | grep vboxdrv
```

If `vboxdrv` is missing and the machine has Secure Boot enabled, the VirtualBox
kernel module is unsigned and will not load. Either sign it with your MOK or
turn Secure Boot off on the build machine.

## Step 2. Confirm the machine can run a VM

```bash
grep -Eoc '(vmx|svm)' /proc/cpuinfo | head -1
```

Anything above 0 is fine. If it returns 0, your Ubuntu machine is itself a
virtual machine and nested virtualisation is disabled on its host. Enable it
there first (on ESXi: "Expose hardware assisted virtualization to the guest OS").

Also check free disk space. The build needs roughly 60 GB temporarily:

```bash
df -h .
```

## Step 3. Get this scaffold and your application onto the machine

```bash
# this directory
cd ~/appliance-build
chmod +x scripts/*.sh bin/*.py
```

Your application source is the GRC repository, for example `~/src/GRC`. It must
be the repository, not the running installation: the build compiles it from
source inside the guest, and only an allowlisted subset is uploaded.

## Step 4. Adapt three files to your application

This is the only manual work, and it is worth doing carefully once.

These are already wired to this repository: `20-app.sh` installs `backend/` and
builds `frontend/`, the systemd unit runs the compiled binary, and
`firstboot.sh` calls `appliance-api migrate` and `appliance-api create-admin`.

What you must supply are the build-time credentials, which never live in the
repository:

```bash
export GRUB_PASSWORD='grub-only-secret'
export SUPPORT_PUBLIC_KEY="$(./tools/sign-challenge keygen | tail -1)"
```

Sanity check your assumptions on your current machine before building:

```bash
cd ~/src/GRC/frontend && npm ci && npm run build && ls dist/
```

If that does not work locally, it will not work in the guest. The API needs no
build step: it is Python, compiled inside the guest by Nuitka.

## Step 5. Run the build

```bash
cd ~/appliance-build
GRUB_PASSWORD='grub-only-secret' ./scripts/build-ova-local.sh ~/src/GRC 1.0.0
```

It takes roughly 15 to 30 minutes depending on your `npm ci` time. The script:

1. downloads the Ubuntu 24.04 cloud image (cached in `.build/` for next time)
2. converts it to a VirtualBox disk and grows it to 40 GB
3. creates a VM with LSI Logic SAS storage, an Intel e1000 NIC and BIOS
   firmware, which is what ESXi expects
4. boots it headless and waits for SSH on `127.0.0.1:2222`
5. stages an allowlisted copy of your source, uploads it, and runs
   `10-base.sh`, `20-app.sh`, `25-protect-app.sh`, `30-harden.sh`,
   `35-lockdown.sh`
6. runs `99-seal.sh`, which audits for secrets, destroys the build identity and
   zeroes free space
7. powers off, removes the build-only CD and port forward
8. exports the OVA and patches it for ESXi

Watch the output of step 6. The two slow steps are `npm ci` for the dashboard
and the Nuitka compile. Both fail loudly there rather than at a customer site,
because `25-protect-app.sh` smoke tests the binary it produced before deleting
the source.

## Step 6. Check the result

```bash
ls -lh output/
tar -tf output/grceye-appliance-1.0.0.ova
```

You should see, in this exact order: the `.ovf` descriptor, the `.mf` manifest,
then the `.vmdk` disk. That ordering is part of the OVA specification and
importers rely on it.

Confirm the hardware family was rewritten:

```bash
tar -xOf output/grceye-appliance-1.0.0.ova --wildcards '*.ovf' \
  | grep -E 'VirtualSystemType|ovf:transport'
```

Expected: `vmx-15` and `com.vmware.guestInfo`. If you still see
`virtualbox-2.2`, ESXi will refuse the import with "Unsupported hardware family".

## Step 7. Test the import before you ship it

Import it back into VirtualBox on the same machine, as a different name:

```bash
VBoxManage import output/grceye-appliance-1.0.0.ova --vsys 0 --vmname smoketest
VBoxManage startvm smoketest --type gui     # or --type headless
```

Boot it and watch the console. You should see the firstboot service run, then
the banner with the URL and the generated admin password. Browse to
`https://<guest-ip>/` and log in. Then delete the smoke test VM:

```bash
VBoxManage unregistervm smoketest --delete
```

Do not skip this. A broken firstboot script is invisible until someone boots the
appliance, and by then it is at a customer site.

## Step 8. Take the OVA off the machine

The file is self-contained. Copy it plus its checksum:

```bash
scp output/grceye-appliance-1.0.0.ova \
    output/grceye-appliance-1.0.0.ova.sha256 \
    user@target-machine:/opt/images/
```

On the target machine, verify before importing:

```bash
cd /opt/images
sha256sum -c grceye-appliance-1.0.0.ova.sha256
```

If SSH is not available, the same file works on a USB drive, an internal HTTP
server, or an S3 bucket. It is a single file with no external dependencies. Just
always ship the checksum next to it, and verify on arrival.

## Step 9. Import on the destination

**vCenter**: Deploy OVF Template, select the file, and you will be prompted for
the vApp properties (address mode, IP, gateway, DNS, hostname) defined in
`ovf/product-section.xml`.

**Standalone ESXi host client**: the import works, but the vApp property form is
not presented. The appliance falls back to DHCP; find its address on the VM
console.

**VMware Workstation or VirtualBox**: imports directly, DHCP.

---

## If you need a bigger or smaller appliance

Edit these before building:

| What | Where |
|---|---|
| Disk size | `DISK_MB` in `build-ova-local.sh` |
| vCPU and RAM | `--memory` and `--cpus` in step 3 of the same script |
| Ubuntu version | `CLOUDIMG_URL` |
| ESXi compatibility floor | `vmx-15` argument in step 10 |

`vmx-15` targets ESXi 6.7 Update 2 and later. Lower it to `vmx-13` if any
customer still runs 6.5. Raising it locks out older hosts, which is one of the
most common import support tickets.

---

## Option B: converting the running machine directly

Only for internal demos. You are shipping your development machine.

```bash
# 1. Stop everything that holds open files or sockets.
sudo systemctl stop nginx postgresql your-app

# 2. Clean the obvious secrets and cruft. This is not exhaustive.
sudo bash scripts/99-seal.sh          # review it first; it locks the build user
history -c && rm -f ~/.bash_history

# 3. Image the disk from a live USB, not from the running system.
#    Booting the machine from a Ubuntu live USB and imaging from there is the
#    only way to get a consistent filesystem.
sudo qemu-img convert -f raw -O vmdk -o subformat=streamOptimized \
  /dev/sda /mnt/external/appliance-disk1.vmdk
```

You then have to hand-write an OVF descriptor around that VMDK, generate the
manifest and tar it in the right order. `scripts/fix-ova-for-esxi.sh` will not
help you here because there is no descriptor to fix.

The honest summary: Option B is more work than Option A once you count the
descriptor authoring, and the result is neither clean nor reproducible. Use
Option A.
