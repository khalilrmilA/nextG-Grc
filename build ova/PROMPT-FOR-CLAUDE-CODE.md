# Prompt for Claude Code

Paste everything below the line into Claude Code from the root of the
`appliance-build` checkout. Replace the three bracketed values in the Context
section first.

---

You are working in the `appliance-build` repository. It is a scaffold that turns
a Node.js + React web application into a VMware virtual appliance shipped as an
OVA. Your job is to finish wiring it to my actual application and to fix the
known defects listed below.

## Context

- Application repository: `[C:\src\myapp or ~/src/myapp]`
- Build host: `[Windows with VMware Workstation Pro | Ubuntu with VirtualBox]`
- Deployment target: VMware ESXi and vCenter, imported from an OVA
- Protection level wanted: `PROTECT_LEVEL=binary` (Node SEA single executable)

## Ground rules

1. **Read before you write.** Start by reading `README.md`, `STEP-BY-STEP.md`,
   `WINDOWS-BUILD.md` and `HARDENING.md` in this repository, then read the
   application repository's `package.json` files, its directory layout, and its
   entrypoints. Do not guess at folder names or npm script names.
2. **Never touch the production server.** The application currently runs on a
   separate Ubuntu machine. Nothing you do may connect to it, read from it, or
   depend on it. The appliance is built from source only.
3. **No secrets in the repository or in the image.** Every OVA copy is byte
   identical, so anything baked at build time is a shared secret across all
   customers. Build-time credentials come from environment variables or Packer
   variables. Runtime secrets are generated in `firstboot.sh`.
4. **Ask me rather than assume** when a decision changes the shipped product:
   the application entrypoint, whether an npm script exists, the ESXi hardware
   version floor, whether SSH should exist at all. A wrong guess here is
   discovered by a customer, not by a test.
5. Style: no em dashes in code comments, documentation or your replies. Use
   colons, semicolons, parentheses or separate sentences.
6. Every shell script must pass `bash -n` and `shellcheck`. Every PowerShell
   script must pass `Invoke-ScriptAnalyzer`. Run them yourself.

## Known defects in the scaffold, fix these

These are real and I already know about them. Address them explicitly.

1. **`PROTECT_LEVEL=binary` breaks first boot.** `25-protect-app.sh` purges
   Node.js from the image, but `scripts/firstboot.sh` still shells out to
   `node /opt/appliance/server/dist/migrate.js` and
   `node .../dist/cli.js create-admin`. Fold both into the SEA binary as
   subcommands (`appliance-api migrate`, `appliance-api create-admin --email
   ... --password ... --must-change-password`) and update `firstboot.sh` to call
   the binary. Confirm my application can expose those subcommands before you
   commit to this design; if it cannot, tell me and propose the alternative.

2. **SSH lockdown ordering kills the build.** `35-lockdown.sh` runs
   `systemctl disable --now ssh` and `systemctl mask ssh`, but the build itself
   is driven over SSH and `99-seal.sh` still has to run afterwards. Move the
   masking so it takes effect on the customer's first boot rather than during
   the build, or make it the final action of `99-seal.sh`. Verify the build
   still completes after your change.

3. **Two referenced helpers do not exist.**
   `files/console/appliance-console.sh` calls `/opt/appliance/bin/admin-reset`
   and `/opt/appliance/bin/support-verify`. Implement both. `support-verify`
   must verify an Ed25519 signature over the challenge string using a public key
   baked into the image; the private key stays on my infrastructure and must
   never appear in this repository. Write a separate `tools/sign-challenge`
   utility for my support team to run on their side.

4. **Placeholders that will fail the build.** `packer/http/user-data` has
   `$6$rounds=4096$REPLACE$ME` as the password hash, and
   `packer/appliance-workstation.pkr.hcl` has
   `sha256:REPLACE_WITH_THE_CHECKSUM_FROM_UBUNTU_SHA256SUMS`. Make both come
   from build variables, and document how to obtain the ISO checksum. Do not
   hardcode a checksum you cannot verify.

5. **The new stages are not wired in.** `25-protect-app.sh` and
   `35-lockdown.sh` are not referenced by `packer/appliance.pkr.hcl`,
   `packer/appliance-workstation.pkr.hcl`, or `scripts/build-ova-local.sh`. Add
   them in the order `10, 20, 25, 30, 35, 99` and pass `PROTECT_LEVEL` and
   `GRUB_PASSWORD` through as build variables.

## Work in phases, stop after each

### Phase 1: survey
Read the application repository and report back to me, before changing anything:
- the actual directory layout and which package builds the API vs the frontend
- the build commands and their output directories
- the server entrypoint file
- whether database migrations exist and how they are invoked
- whether any admin-user bootstrap path exists
- anything in the app that assumes a writable working directory, a local file
  path, or an environment variable I have not accounted for

Then tell me which of the six items above are missing and what you propose to
add to my application to support appliance deployment.

### Phase 2: adapt
With my approval on Phase 1, update `scripts/20-app.sh`,
`scripts/25-protect-app.sh`, `files/systemd/appliance-api.service` and
`scripts/firstboot.sh` to match the real project. Fix defects 1 through 5.

### Phase 3: verify without building
Static checks only, since a full build takes half an hour:
- `bash -n` and `shellcheck` on every shell script
- confirm every file path referenced by one script is created by another
- confirm no script references Node after `25-protect-app.sh` purges it
- confirm nothing writes a secret to a file that survives `99-seal.sh`
- `packer validate` on both templates
- grep the whole tree for leftover placeholders and TODOs

Produce a table of what you checked and the result.

### Phase 4: build
Only when I say so. Run the build with `headless = false` on the first attempt
so I can watch the autoinstall boot command land. Report where it fails rather
than retrying blindly.

### Phase 5: import test
Import the resulting OVA back into the local hypervisor under a throwaway name,
boot it, and confirm from the console that the firstboot service ran, the
banner shows a URL and generated admin password, and the web console answers on
443. Then destroy the test VM. Do not skip this: a broken `firstboot.sh` is
invisible until someone powers the appliance on at a customer site.

## What I do not want

- Do not add disk encryption. I read the trade-off and decided against it for
  version 1.
- Do not add telemetry, phone-home, or any outbound connection from the
  appliance. Several of my customers deploy air-gapped.
- Do not raise the hardware version above `vmx-15` without asking me.
- Do not commit anything to git. Show me diffs; I will commit.
