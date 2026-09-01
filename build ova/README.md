# GRC platform as a vSphere OVA appliance

This turns the GRC platform into a reproducible virtual appliance: an OVA an
operator imports into vCenter, powers on, and reaches over HTTPS without
touching a shell.

The whole build is driven by Packer so the image is rebuildable from source and
versioned, rather than being a hand-configured VM someone cloned once.

## What this appliance actually contains

The application is **FastAPI (Python 3.12) plus a React dashboard**, not the
Node monorepo an earlier version of this scaffold assumed. That distinction
drives most of the design here:

| Piece | Where it comes from | How it ships |
|---|---|---|
| API | `backend/` (FastAPI, SQLAlchemy) | compiled by Nuitka to a single standalone binary |
| Dashboard | `frontend/` (React, Vite) | built to static files, served by nginx |
| CLI | `backend/appliance_cli.py` | the same binary: `serve`, `migrate`, `create-admin`, ... |
| Database | SQLite at `/var/lib/appliance/grc.db` | seeded from a clean reference database |
| Reference data | `release/seed/grc_seed.db` | 77 frameworks, 3799 controls, 691 threats, no customer data |

The marketing site (`marketing/`) and the production gateway (`gateway.js`) are
not part of the appliance. nginx replaces the gateway, and the dashboard is
served from `/` rather than `/app`.

## Layout

```
build ova/
├── packer/
│   ├── appliance.pkr.hcl              vsphere-iso builder (needs vCenter)
│   ├── appliance-workstation.pkr.hcl  vmware-iso builder (VMware Workstation)
│   └── http/                          Ubuntu autoinstall seed, rendered from variables
├── scripts/
│   ├── 10-base.sh          Python, nginx, OCR, open-vm-tools, Node for the frontend build
│   ├── 20-app.sh           allowlisted install of the app, dashboard build, seed database
│   ├── 25-protect-app.sh   Nuitka compile, source destruction, execute-only permissions
│   ├── 30-harden.sh        SSH config, ufw, fail2ban, sysctl
│   ├── 35-lockdown.sh      restricted console, GRUB password, ptrace, AppArmor, toolchain removal
│   ├── 99-seal.sh          destroys build identity, audits for secrets, zeroes free space
│   ├── firstboot.sh        per-deployment identity, secrets, database, certificate
│   ├── netconfig.sh        netplan writer (DHCP or static)
│   ├── build-ova-local.sh  Linux + VirtualBox build driver
│   └── Build-Ova.ps1       Windows + VMware Workstation build driver
├── files/
│   ├── systemd/            API unit, firstboot unit, SSH lockdown unit
│   ├── nginx/appliance.conf TLS termination, SPA routing, /api proxy to 127.0.0.1:8000
│   └── console/            restricted tty1 menu
├── bin/
│   ├── ovfprops.py         reads vApp properties from VMware Tools
│   ├── admin-reset         console helper: reset the administrator password
│   └── support-verify      console helper: verify a signed support response
├── tools/sign-challenge    vendor-side support signing utility (never on the appliance)
├── ovf/product-section.xml vApp property definitions to inject
└── seed/user-data          cloud-init seed for the VirtualBox path
```

## Protection levels

`PROTECT_LEVEL` trades protection against build time. The API is Python, so the
Node SEA approach does not apply; Nuitka is the equivalent.

```
PROTECT_LEVEL=bundle     run from the virtualenv, source intact. Fast builds.
PROTECT_LEVEL=obfuscate  byte-compile, delete every .py. Decompilable in minutes.
PROTECT_LEVEL=binary     Nuitka standalone compile to C. Default for release.
```

Be precise about what `binary` removes. No application source and no
application bytecode remain, and the binary is `root:appliance` mode `0050`, so
the service can execute it but nothing can read it. The **system** `python3`
stays: Ubuntu's `netplan` command line tool is Python and `firstboot.sh`
configures the network through it, so purging the interpreter would leave the
appliance unable to get an address.

## Build

Credentials come from the environment, never from this repository.

### Windows, VMware Workstation Pro

```powershell
$env:BUILD_PASSWORD      = 'build-only-secret'
$env:BUILD_PASSWORD_HASH = '$6$...'      # mkpasswd -m sha-512
$env:GRUB_PASSWORD       = 'grub-only-secret'

cd 'D:\GRC\build ova\packer'
packer init appliance-workstation.pkr.hcl     # per file, not "packer init ."

cd ..\scripts
.\Build-Ova.ps1 -AppSource D:\GRC -Version 1.0.0 -Headless $false `
    -SupportPublicKey '<from tools/sign-challenge keygen>'
```

Run the first build with `-Headless $false` so you can watch the autoinstall
boot command land on the GRUB menu. It is tied to the exact ISO.

### Linux, VirtualBox

```bash
export GRUB_PASSWORD='grub-only-secret'
export SUPPORT_PUBLIC_KEY='<from tools/sign-challenge keygen>'
./scripts/build-ova-local.sh /path/to/GRC 1.0.0
```

### A note on `packer init`

Both templates live in `packer/`, and they both define `local.vm_name`. Running
`packer init .` loads them as one configuration and fails with "Local variable
vm_name is defined twice". Always name the file:

```bash
packer init appliance-workstation.pkr.hcl
packer validate appliance-workstation.pkr.hcl
```

### Hardware version

`vm_version = 15` targets ESXi 6.7 Update 2 and later. The VMware Packer plugin
**2.x refuses anything below 19**, so `appliance-workstation.pkr.hcl` pins the
plugin to `~> 1.1`. Do not relax that pin without deciding to raise the ESXi
floor: a newer hardware version makes the OVA unimportable on older hosts,
which is a common support ticket.

## Support access

There is no shipped root password and no permanent backdoor. An administrator
opens the console menu, chooses temporary support access, and reads out a
challenge. Support signs it on vendor infrastructure:

```bash
./tools/sign-challenge keygen --out-private ~/.secrets/support-ed25519.key
./tools/sign-challenge sign   --key ~/.secrets/support-ed25519.key <challenge>
```

The appliance verifies the Ed25519 signature against the public key baked into
the image, and separately confirms the challenge is one it issued in the last
three hours. Both checks matter: verifying only the signature would let a
challenge and response pair captured once work forever, on every appliance
sharing the key.

## Licensing

Two paths, and the trust model is identical in both:

- **Offline** (works everywhere, including air-gapped): an administrator pastes
  the signed licence key into the web console. `POST /license/activate`.
- **Online** (optional): set the licence server URL as a vApp property or in
  `/etc/appliance/app.env`, and the console can exchange an activation code for
  a key. `POST /license/activate-online`.

Online activation fetches a key and then verifies it locally against the public
key compiled into the build, exactly as a pasted key is verified. A spoofed
licence server cannot mint a licence this appliance accepts. Nothing contacts
the licence server unless an administrator activates a licence by hand.

## Boot sequence on the customer side

1. Operator deploys the OVA in vCenter and fills in the vApp properties.
2. `appliance-firstboot.service` runs once, before the API and nginx:
   regenerates machine-id and SSH host keys, applies network configuration,
   installs the reference database, generates `SECRET_KEY`, issues a
   self-signed certificate with the correct SAN, applies migrations, removes
   the account the reference database ships with, and creates the administrator
   with a random password.
3. `appliance-ssh-lockdown.service` disables and masks SSH.
4. The URL and credentials appear on the VM console (`/etc/issue`).
5. Admin logs in over HTTPS and is forced to change the password.

## Things that bite people

- **Standalone ESXi ignores vApp properties.** Only vCenter presents the deploy
  wizard, so `firstboot.sh` defaults to DHCP and every property has a working
  default.
- **Never bake secrets into the image.** Every copy of an OVA is byte identical.
  `20-app.sh` copies by allowlist and audits the result; `99-seal.sh` audits
  again and fails the build rather than shipping a secret.
- **The initial admin password is written to `/etc/issue`** so it is visible on
  the console. It is single use in practice, because `must_change_password` is
  set, but it does persist until someone changes it.
- **Zeroing free space matters.** Without `99-seal.sh` the compressed OVA can
  easily be several times larger than necessary.
- **Exporting from VirtualBox is a trap** if the target is ESXi: the default
  hardware family is rejected on import. `scripts/fix-ova-for-esxi.sh` rewrites
  the descriptor and repacks in the required member order.

## Updating a deployed appliance

Reimporting a new OVA discards customer data, so plan the update path now:

- All state lives under `/var/lib/appliance` (database and uploads), nothing
  under `/opt`. That separation is what makes an in-place update possible.
- Ship signed bundles applied by a small updater service, and have the web
  console expose "upload update package".
- `/etc/appliance/version` records the build, and the console shows it, so
  support can tell what a customer is running.
