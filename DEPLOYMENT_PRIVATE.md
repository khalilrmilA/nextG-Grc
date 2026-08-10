# GRC Platform — VENDOR-PRIVATE On-Prem Release Runbook

**Internal document. Never ship this file, the live database, or the license
private key to a client.** (It is excluded from Docker build contexts via
`.dockerignore`, but treat that as a backstop, not the guarantee.)

---

## 1. One-time setup: the license signing keypair

Generate a single Ed25519 keypair (script provided by the licensing workstream):

```bash
cd backend
venv/bin/python -m scripts.generate_license_keypair
```

It prints two values:

| Key | Where it lives | Notes |
|---|---|---|
| `LICENSE_PRIVATE_KEY` | `.env` of the **vendor SaaS server only** (this machine) | Signs license keys minted via the super-admin Licenses tab / `POST /api/v1/admin/licenses`. Never committed, never shipped, never baked into any build. Losing it means you can no longer issue keys that existing client builds accept — back it up offline (password manager / sealed envelope). |
| `LICENSE_PUBLIC_KEY` | Baked into every protected client build (`app/core/build_info.py`) via the `LICENSE_PUBLIC_KEY` build arg | Safe to distribute. Also settable via env on unprotected test installs. |

Generate it **once** and reuse the same public key for every client build, or
key rotation will invalidate previously issued licenses.

## 2. One-time setup: PyArmor license

The free PyArmor trial cannot obfuscate several files in `backend/app`
("Too big code object, the limitation is 32768 bytes in trial version"), so
**a paid PyArmor Basic (or Pro) license is required** for real client builds.

1. Purchase at pyarmor.dashingsoft.com; you receive a `pyarmor-regfile-*.zip`.
2. Keep it out of git; store alongside the private key backup.
3. Pass its path as the 6th argument to `scripts/build_client_release.sh` —
   the script copies it into `release/pyarmor/` (inside the build context) and
   the Dockerfile runs `pyarmor reg` before `pyarmor gen`. The regfile only
   exists in the throwaway obfuscation build stage, never in the shipped image.

## 3. Building a client release

```bash
scripts/build_client_release.sh 1.0.0 "Acme Corp" admin@acme.example \
    'A-Strong-Initial-Password' <LICENSE_PUBLIC_KEY-or-path-to-file> \
    /secure/pyarmor-regfile-XXXX.zip
```

What it does, in order:

1. **Clean seed DB** — `backend/scripts/make_client_seed_db.py` snapshots
   `backend/grc_dev.db` (opened strictly read-only; the live DB is never
   touched) into `release/seed/grc_seed.db`, deletes every row of every table
   except built-in frameworks/controls/requirements, built-in threats and
   mandatory documents, then creates the client's tenant + `tenant_admin` +
   enterprise subscription. It re-opens the output and hard-fails unless
   users==1, tenants==1 and all customer-data tables are at 0 rows.
2. **Protected backend image** — `infrastructure/docker/Dockerfile.backend.onprem`
   overwrites `app/core/build_info.py` with `LICENSED_BUILD = True` + the real
   public key **before** PyArmor obfuscation, so the client cannot disable
   enforcement via env. Only obfuscated bytecode ships.
3. **Frontend image** — Vite production build inside the container (the host's
   `frontend/dist` is untouched); the build fails if any `.map` source maps
   would ship. nginx serves the SPA and proxies `/api/` to the backend.
4. **Bundle** — `release/bundle-<version>/` with the gzipped `docker save`
   tarball of both images, `docker-compose.onprem.yml`,
   `.env.onprem.example` and a generated client-facing `INSTALL.md`.

Deliver the bundle directory (encrypted transfer / physical media). Send the
initial admin password out-of-band — it is not written into the bundle.

> Note: this production box should not run `docker build`. Run the build step
> on a separate build machine — the script stops cleanly after the seed-DB
> step when Docker is absent, and `release/seed/grc_seed.db` is safe to copy
> to the build machine along with the repo.

## 4. Issuing and renewing license keys

1. Log into the SaaS as a super admin (the server whose `.env` holds
   `LICENSE_PRIVATE_KEY`).
2. Super Admin → **Licenses** tab → issue a key: customer name, contact email,
   duration in days (max 3650), optional notes. The API equivalent is
   `POST /api/v1/admin/licenses` (super-admin only).
3. Send the key string to the client. They paste it on their `/license`
   screen (tenant_admin or super_admin role required to activate).
4. **Renewal** = issue a fresh key with a new duration and have the client
   paste it on the same screen. Activation replaces the previous key
   instantly; nothing needs restarting.

Keys are Ed25519-signed payloads (`customer`, `email`, `issued_at`,
`expires_at`, unique `lid`) — they cannot be forged or extended without the
private key. When a license expires the client's API returns
`402 license_expired` and the UI locks to the `/license` screen until a new
key is pasted; their data is untouched.

## 5. Shipping updates to a client

1. Build a new release with the **same public key** and a bumped version:
   the seed DB step runs again but is only used for *fresh* installs — an
   existing client's `/data/grc.db` is never overwritten (the entrypoint seeds
   only when the file is missing).
2. Send the new `grc-onprem-<version>.tar.gz`. The client runs
   `docker load -i …` then `docker compose -f docker-compose.onprem.yml up -d`.
3. Schema changes: the app runs `Base.metadata.create_all()` at startup, which
   adds **new tables** automatically. New **columns on existing tables** need
   an explicit migration — ship an alembic revision (the image contains
   `alembic/` + `alembic.ini` at `/srv`) and document the
   `docker compose exec backend alembic upgrade head` step in that release's
   notes.

## 6. What this protects — and what it cannot

**It protects against:**
- Casual source reading, copy-paste reuse, and trivial redistribution — the
  shipped backend is PyArmor-obfuscated bytecode, not `.py` source.
- Disabling license checks via configuration — `LICENSED_BUILD = True` and the
  public key are baked in before obfuscation.
- Forged or extended licenses — Ed25519 signatures, private key never leaves
  your server.
- Simple clock rollback — activations track `last_seen_at`; turning the clock
  back more than 24 h invalidates the license until corrected.
- Shipping customer data — the seed script's hard assertions.

**It cannot protect against:**
- A determined attacker with full control of the hardware. PyArmor raises the
  cost of reverse engineering drastically, but *anything that runs on a
  machine you do not control can eventually be broken* — memory dumps,
  runtime hooking, or patching the container are all theoretically possible.
- Clients keeping the last valid build running forever offline (there is no
  phone-home).
- A **frozen or slowly-held clock**. The rollback guard only fires when the
  clock jumps back more than 24 h at once; a client who freezes the host
  clock (or steps it back ≤ 24 h per day) keeps the current license "valid"
  past its real expiry. Expiry is only enforced against roughly-correct
  clocks — if this matters commercially, cover it in the contract, or ask
  for periodic online re-validation as a renewal condition.

Treat the technical protection as one layer. The license **contract** —
audit rights, termination and penalty clauses — is the other, and for
determined bad actors the contract is the one that actually bites.

## 7. Pre-delivery security checklist

Before every bundle leaves the building:

- [ ] `tar tzf release/bundle-<v>/grc-onprem-<v>.tar.gz | grep -E '\.env|grc_dev\.db'`
      returns nothing.
- [ ] Seed-script run printed **"All safety assertions passed."** for THIS build.
- [ ] Spot-check the seed: open `release/seed/grc_seed.db` and confirm
      `users`=1 (the client admin), `risks`/`vendors`/`audits`/`policies`/
      `incidents`/`activity_logs` all 0.
- [ ] `LICENSE_PRIVATE_KEY` appears nowhere in the bundle
      (`grep -r` the bundle dir) and was never passed as a build arg.
- [ ] The backend image contains no readable source:
      `docker run --rm --entrypoint cat grc-backend:onprem /srv/app/main.py`
      shows PyArmor stub imports, not the real code.
- [ ] `DEPLOYMENT_PRIVATE.md` is not in the bundle.
- [ ] The admin password goes out-of-band, never by the same channel as the
      bundle.
