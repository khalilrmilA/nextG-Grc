# GRCEye Appliance — deployment guide

What to send a customer with the image, and what they do with it.

---

## Which file to send

| Customer runs | Send them | Time to running |
|---|---|---|
| VMware ESXi, vCenter, Workstation, Fusion | `grceye-appliance-<version>.ova` | about 2 minutes |
| Hyper-V | the **VHD** (`scripts\Convert-Disk.ps1`) | about 5 minutes |
| Azure | the **VHD**, uploaded as a managed image | about 10 minutes |
| Bare metal, or "we want to install it ourselves" | `grceye-appliance-<version>-installer.iso` | about 60 minutes |

Always send the matching `.sha256` file and tell them to check it. A truncated
download produces failures that look like software faults and waste a support
call.

```powershell
Get-FileHash .\grceye-appliance-1.0.0.ova -Algorithm SHA256
```

---

## Requirements

|  | Minimum | Recommended |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB | 100 GB |
| Network | one adapter, DHCP or static | |

No internet connection is required. The appliance is designed to run
air-gapped: every outbound feed is off by default.

---

## Deploying the OVA

1. **Deploy OVF Template** and select the `.ova`.
2. On the properties page, optionally set the hostname, organisation name and a
   static address. Leave them blank for DHCP.
3. Power on.
4. Watch the console. The first boot takes two to three minutes while it
   generates this deployment's own keys, certificate and administrator account.
5. The console then shows the address and the login details.

### What the console shows

```
=======================================================
  grceye-appliance 1.0.0
  Host : appliance
  URL  : http://10.0.2.15/
=======================================================

  FIRST LOGIN
  -----------
  Web console : http://10.0.2.15/

  Administrator
    Username  : admin@appliance.lan
    Password  : <generated, different on every deployment>

  Platform super administrator (/super-admin)
    Username  : superadmin@appliance.lan
    Password  : <generated, different on every deployment>

  Both passwords must be changed at first login.
```

Two accounts, and they are not interchangeable:

- **Administrator** runs the business: risks, audits, policies, compliance.
- **Platform super administrator** manages the platform itself at
  `/super-admin`: tenants, users, and which features each organisation can use.

Every deployment generates its own passwords. No two appliances share a
credential.

---

## First login

Browse to the address shown. No certificate warning: the console is served over
plain HTTP on port 80.

That means traffic between the browser and the appliance is **not encrypted**.
This is intended for a trusted internal network. Do not expose the appliance
directly to the internet; put it behind your own reverse proxy or VPN if remote
access is needed.

Anyone on the same network can reach it. The application backend is bound to
localhost only, so the web server is the only way in.

---

## Using your own AI

By default the appliance uses its bundled model and sends nothing outside your
network.

To use your own provider instead, on the console choose **7) AI provider**:

- **OpenAI compatible** covers OpenAI, Azure OpenAI, vLLM, LiteLLM, Groq,
  Together and Anthropic's OpenAI-compatible endpoint. Give the endpoint
  including its version segment, for example `https://api.openai.com/v1`.
- **Ollama** for another Ollama server on your network.

The API key is typed without echo and stored readable only by the application.
It is never included in the image: every copy of the appliance is identical, so
nothing customer-specific is ever baked in.

Plain `http` is refused to public addresses, and a key embedded in the URL is
refused outright, because both leak the credential.

Choose **Go back to the bundled model** at any time to revert.

---

## Console menu

The console is the only local interface. There is deliberately no shell and no
account that can log in over SSH.

| | |
|---|---|
| 1 | Status of the application, web server and first boot |
| 2 | Network configuration: DHCP or a static address |
| 3 | View logs |
| 4 | Reset the administrator password |
| 5 | Temporary support access (requires a signed challenge from us) |
| 6 | Licence status |
| 7 | AI provider |
| 8 | Reboot |
| 9 | Shut down |

---

## Installing from the ISO

Use this for bare metal, or when the customer wants to install it themselves.

1. Write the ISO to a USB stick, or attach it through iDRAC, iLO or a VM's
   optical drive.
2. Boot it. It boots on both BIOS and UEFI.
3. Choose the first entry. **It erases the target disk.** The menu waits
   indefinitely and never boots by itself, so an ISO left in a drive cannot wipe
   a machine on its own.
4. Ubuntu installs unattended, then reboots.
5. `Preparing the appliance` appears on the console. **This step needs an
   internet connection** and takes 40 to 60 minutes.
6. It reboots again and shows the same first-login details as the OVA.

If the machine has more than one disk, the installer stops and lists them rather
than guessing which one to erase.

---

## Backups

The whole appliance lives in `/var/lib/appliance`: the database and every
uploaded file. Back it up with your hypervisor's snapshot or replication.

There is no scheduled backup inside the appliance. That is deliberate: where
backups go is your decision, not ours.

---

## Support

The console's **Temporary support access** produces a challenge string. Send it
to us and we return a signed response, which opens a shell for 60 minutes and
then closes it automatically. The response only works on that appliance, in that
hour, and cannot be replayed.

We cannot access your appliance without you reading us that challenge.
