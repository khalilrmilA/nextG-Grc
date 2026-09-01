# Hardening the appliance and protecting the application code

## Read this part first

You are shipping a VM to someone who controls the hypervisor it runs on. That
person can power it off, detach the virtual disk, mount it on another machine,
and read every byte. They can snapshot RAM while the application is running and
carve keys out of the dump. No configuration inside the guest prevents any of
that, because the guest is not the trust boundary. Their hypervisor is.

So "they cannot access the source code" is not an achievable goal against a
determined and skilled customer. What is achievable, and what this document
builds, is:

1. **No accidental exposure.** A normal administrator doing normal things never
   sees your source. No shell, no source tree, no source maps, no git history.
2. **Extraction costs real effort.** Bundled, obfuscated, compiled to a single
   binary. Recovering something maintainable takes a skilled person days, not a
   curious one ten minutes.
3. **Tampering is detectable and useless.** Modified images fail their integrity
   check and fail licensing.
4. **A compromised application cannot read itself.** An RCE in your web app does
   not hand the attacker your binary.
5. **Legal and commercial teeth.** The EULA plus a real licence enforcement path
   is what actually protects revenue.

Point 5 matters more than points 1 to 4 combined. In practice, competitors do
not reverse engineer appliances; they hire your customers' engineers or just
build their own. The customers who would steal your code are the ones who will
not pay anyway. Spend proportionate effort here, and spend the savings on
licence enforcement and on making the product worth renewing.

I am spelling this out because building a very expensive obfuscation pipeline
and then believing the code is safe is worse than building a modest one and
knowing exactly where the limits are.

---

## What each layer actually buys you

| Layer | Stops | Does not stop | Cost |
|---|---|---|---|
| Ship build output only, no source maps | Reading your actual source | Reading readable bundled JS | Free |
| Bundle with esbuild | Module structure, file names | Reading logic | Free |
| Obfuscation | Casual reading, quick greps | A patient reverse engineer | Runtime slowdown |
| Nuitka compile to C | Trivial `cat` of your code | `strings`, memory carving | Build complexity |
| Native module for licence logic | Patching the licence check in JS | Someone who knows Ghidra | Real dev effort |
| No shell, restricted console | Every normal administrator | Mounting the disk elsewhere | Low |
| GRUB password | `init=/bin/bash` at boot | Mounting the disk elsewhere | Low |
| Read-only root, noexec mounts | Persistence, casual tampering | Offline reading | Low |
| `ptrace_scope=3`, no core dumps | Live memory dumping from inside | Hypervisor memory snapshot | Free |
| LUKS bound to vTPM | Offline disk mounting | The customer's own vTPM | High, see below |
| LUKS bound to your key server | Offline mounting, cloning | Air-gapped deployment | High, see below |

### The disk encryption question

Encryption is the only thing that stops offline disk reading, and it forces a
choice you cannot avoid: the key has to come from somewhere at boot.

- **Key on the disk.** Pointless. It is right there.
- **Key sealed to a virtual TPM.** Raises the bar meaningfully. But the vTPM is
  provided by the customer's hypervisor, which they control, so it is a speed
  bump for a skilled adversary, not a wall.
- **Key from a server you host (Tang/NBDE or your own service).** Genuinely
  strong, and gives you a revocation lever. But the appliance now must reach
  your infrastructure at every boot. For your MENA and public sector clients
  that is often an immediate disqualification, and it turns your availability
  into their availability.

My recommendation: do not encrypt the root filesystem in v1. Do the cheap layers
properly, put your licence check in a native module, and revisit encryption only
if a specific customer contract demands it. The complexity and the support
burden of a boot-time key dependency are real and they arrive on day one, while
the threat it addresses is speculative.

---

## Build order

Insert one step into the pipeline you already have:

```
10-base.sh      runtimes
20-app.sh       build the app
25-protect-app.sh   <-- new: bundle, obfuscate, compile, remove all source
30-harden.sh    OS baseline
35-lockdown.sh  <-- new: no shell, GRUB password, mount options, ptrace
99-seal.sh      destroy build identity
```

Both are wired into `packer/appliance.pkr.hcl`,
`packer/appliance-workstation.pkr.hcl` and `scripts/build-ova-local.sh`, with
`PROTECT_LEVEL` and `GRUB_PASSWORD` passed through as build variables.

Note the SSH ordering. `35-lockdown.sh` does **not** mask SSH: the build is
driven over it and `99-seal.sh` still has to run afterwards. `99-seal.sh`
disables it at next boot as its final action, and
`appliance-ssh-lockdown.service` masks it on the customer's first boot.

## Protection level

`25-protect-app.sh` takes a level so you can trade protection against build time
and runtime cost:

```bash
PROTECT_LEVEL=bundle     # run from the virtualenv, source intact. Fast builds.
PROTECT_LEVEL=obfuscate  # byte-compile, delete every .py. Decompilable.
PROTECT_LEVEL=binary     # Nuitka standalone compile to C. Default for release.
```

The API is Python, so the Node SEA route described in earlier drafts of this
document does not apply. Nuitka is the equivalent: it compiles to C extension
modules plus a launcher, and the dist carries its own libpython.

Be precise about what `binary` removes. No application source and no
application bytecode remain, and the binary is mode 0050 so the service can
execute it but nothing can read it. The **system** `python3` stays, because
Ubuntu's `netplan` tool is Python and `firstboot.sh` configures the network
through it. Claiming "Python is removed from the image" would be false.

`25-protect-app.sh` smoke tests the compiled binary (`version`, `migrate`,
`create-admin`) before deleting the source. A Nuitka build missing a lazily
imported module compiles cleanly and then fails on the customer's first boot;
the smoke test turns that into a build failure.

### A warning on stack traces

A compiled build reports tracebacks against compiled frames, so a crash report
from a customer is far less legible than one from a source deployment. Keep the
build tree for every released version in your own artefact store, indexed by
version, or support will be reading addresses for the rest of the product's
life. Never ship it inside the appliance.

The licence check is a compiled constant rather than an environment variable:
`25-protect-app.sh` overwrites `app/core/build_info.py` with `LICENSED_BUILD`
and the customer-facing public key **before** Nuitka runs, so a customer cannot
disable enforcement or swap the key at runtime.

## Console access after lockdown

`35-lockdown.sh` replaces the login shell with a fixed menu on tty1: network
configuration, service status, log viewing, admin password reset, reboot,
shutdown, and a support access mode. There is no path from the menu to a shell.
The pager runs with `LESSSECURE=1` so the usual `!command` escape is closed, and
no editor is installed.

Support access works like this: an administrator enables it from the menu, the
appliance prints a challenge string, and your support team returns a response
signed with a key only you hold. That unlocks a root shell for a fixed period
and logs it. This means you can always support a customer without a permanent
backdoor account and without shipping a shared root password across your entire
install base.

The console is `files/console/appliance-console.sh`; the two helpers it calls
are `bin/admin-reset` and `bin/support-verify`. The signing side is
`tools/sign-challenge`, which runs on your infrastructure. Only the public key
is baked into the image.

Verification checks two things, and both matter: that the Ed25519 signature is
valid, and that the challenge is one this appliance issued in the last three
hours. Checking only the signature would let a challenge and response pair
captured once work forever, on every appliance sharing the public key.

## Do not skip these

- **Remove the build toolchain.** npm, gcc, make, git and headers left in the
  image are a gift to anyone poking at it, and they inflate the OVA.
- **Execute-only binaries.** `chown root:appliance` plus mode `0050` means the
  service can run the binary but cannot read or copy it. An RCE in your web
  application then cannot exfiltrate your product.
- **Disable core dumps and set `kernel.yama.ptrace_scope=3`.** Otherwise anyone
  who reaches a shell can attach to the running process and dump your decrypted
  code and secrets straight out of memory.
- **Never bake a licence key, signing key or API credential into the image.**
  Every copy is byte identical. Ship the public key for verification; keep the
  private key on your side.
