packer {
  required_plugins {
    virtualbox = {
      version = "~> 1.1"
      source  = "github.com/hashicorp/virtualbox"
    }
  }
}

# Build path for a Windows or Linux host that has VirtualBox but not VMware
# Workstation. VirtualBox writes "virtualbox-2.2" as the hardware family, which
# ESXi rejects with "Unsupported hardware family", so the OVA this produces is
# post-processed by scripts/Fix-OvaForEsxi.ps1 (or scripts/fix-ova-for-esxi.sh)
# to rewrite the descriptor to vmx-15 and inject the vApp properties.
#
# Unlike the Workstation path this needs no ovftool: the builder exports an OVA
# directly and the fix script uses only tar.

variable "iso_url" {
  type    = string
  default = "https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-live-server-amd64.iso"
}

# Fetched from Canonical's own published list rather than pasted in by hand.
# See the note in appliance-workstation.pkr.hcl for pinning a literal instead.
variable "iso_checksum" {
  type    = string
  default = "file:https://releases.ubuntu.com/24.04.3/SHA256SUMS"
}

variable "appliance_name" {
  type    = string
  default = "grceye-appliance"
}

variable "appliance_version" {
  type    = string
  default = "1.0.0"
}

variable "appliance_vendor" {
  type    = string
  default = "Next Step IT"
}

variable "build_user" {
  type    = string
  default = "builder"
}

variable "build_password" {
  type      = string
  sensitive = true
}

# SHA-512 crypt hash of build_password: mkpasswd -m sha-512
variable "build_password_hash" {
  type      = string
  sensitive = true
}

variable "app_source" {
  type    = string
  default = "../../.."
}

# vmware | hyperv | azure. Decides guest integration tooling, the lockdown
# profile and how firstboot.sh obtains its deployment properties.
variable "appliance_target" {
  type    = string
  default = "vmware"
}

# Test builds only. Skips the apt upgrade and the free-space zeroing, which
# together cost about 35 minutes and matter only for a shipped image. Kept
# separate from protect_level so a fast build can still exercise the Nuitka
# compile, which is the step most worth testing.
variable "fast_build" {
  type    = string
  default = "0"
}

# bundle | obfuscate | binary. See scripts/25-protect-app.sh.
variable "protect_level" {
  type    = string
  default = "binary"
}

# Required by scripts/35-lockdown.sh. Never a literal in this repository.
variable "grub_password" {
  type      = string
  sensitive = true
}

# Public halves only. The private keys stay on vendor infrastructure.
variable "support_public_key" {
  type    = string
  default = ""
}

variable "license_public_key" {
  type    = string
  default = ""
}

variable "license_enforcement" {
  type    = string
  default = "True"
}

# Fixed platform super-administrator password, baked at build time.
#
# The appliance console deliberately shows NO credentials at boot, so the
# operator arrives at a client site already holding this password, signs in to
# /super-admin, activates the licence and creates the client's own accounts.
#
# This is a SHARED credential: every appliance built from this image accepts it.
# It is seeded into the database at firstboot and the cleartext copy is shredded
# immediately afterwards, so only the bcrypt hash survives on a deployed unit.
# Leave empty to keep the old per-deployment random password.
variable "superadmin_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "headless" {
  type    = bool
  default = true
}

# Build-time resources. The VM is transient and vboxmanage_post resets the
# hardware to the shipped spec before export, so these never reach a customer.
#
# CPU is the cheap win: Nuitka parallelises its C compilation across cores, and
# a 16-thread host loses nothing by lending 6 to the guest.
#
# Memory is NOT free, and over-allocating makes builds SLOWER, not faster. Check
# the host first:
#   (Get-CimInstance Win32_OperatingSystem) | select FreePhysicalMemory
#   Get-Counter '\Memory\Committed Bytes','\Memory\Commit Limit'
# If commit charge is already near the limit, handing the guest more RAM pushes
# the HOST into swapping and everything gets worse. Raise build_memory only when
# there is real headroom.
variable "build_cpus" {
  type    = number
  default = 8
}

variable "build_memory" {
  type    = number
  default = 10240
}

# What the CUSTOMER gets. The appliance runs one uvicorn worker, nginx and
# SQLite, so 2 vCPU / 4 GB is the right shipped default; raising it would make
# the OVA demand resources it does not need.
variable "appliance_cpus" {
  type    = number
  default = 2
}

variable "appliance_memory" {
  type    = number
  default = 4096
}

locals {
  vm_name = "${var.appliance_name}-${var.appliance_version}"
}

source "virtualbox-iso" "appliance" {
  vm_name          = local.vm_name
  output_directory = "../output/vbox"
  # VMware wants a packaged OVA. Hyper-V and Azure want a bare disk that
  # Convert-Disk.ps1 turns into a VHD, so leave the VMDK loose for those.
  format = var.appliance_target == "vmware" ? "ova" : "ovf"
  # Run the first build with -var 'headless=false' so the autoinstall boot
  # command can be watched landing on the GRUB menu.
  headless = var.headless

  iso_url      = var.iso_url
  iso_checksum = var.iso_checksum

  guest_os_type = "Ubuntu_64"
  firmware      = "bios"

  # BUILD-time resources, not what the customer receives. The Nuitka compile in
  # 25-protect-app.sh is CPU bound and memory hungry: 2 vCPU / 4 GB makes it
  # crawl and risks the compiler being OOM killed on a codebase this size.
  # vboxmanage_post below resets the VM to the shipped appliance spec before the
  # OVA is exported, so these values never reach the customer.
  cpus      = var.build_cpus
  memory    = var.build_memory
  disk_size = 40960

  # SCSI presents as LSI Logic, which is what ESXi expects after the descriptor
  # is rewritten. SATA is VirtualBox's default and is a frequent import failure.
  hard_drive_interface = "scsi"
  iso_interface        = "ide"

  # Guest additions are a build-time convenience that would ship in the image.
  # open-vm-tools is installed instead, by 10-base.sh.
  guest_additions_mode = "disable"

  vboxmanage = [
    # Intel PRO/1000 MT Server: the adapter ESXi maps cleanly on import.
    ["modifyvm", "{{ .Name }}", "--nictype1", "82545EM"],
    ["modifyvm", "{{ .Name }}", "--audio-driver", "none"],
    ["modifyvm", "{{ .Name }}", "--usb", "off"],
    ["modifyvm", "{{ .Name }}", "--rtcuseutc", "on"],
    ["modifyvm", "{{ .Name }}", "--vram", "16"],
    ["modifyvm", "{{ .Name }}", "--graphicscontroller", "vmsvga"],

    # Closing a VirtualBox window must NOT kill the build.
    #
    # Packer runs the VM headless, but the VirtualBox Manager can attach a GUI
    # window to a running headless VM ("Show"/"Afficher"). VirtualBox's default
    # action when that window closes is to POWER OFF the machine. Twice on
    # 2026-09-02 that ended a build mid-flight: the VM went RUNNING -> Stopping
    # -> TERMINATED, VirtualBox deregistered it and deleted the 40 GB disk,
    # and packer sat waiting for SSH from a machine that no longer existed.
    # The first loss was 9 minutes in, the second 26.
    #
    # Detach leaves the VM running and just closes the window, so looking at
    # the build can no longer destroy it.
    ["setextradata", "{{ .Name }}", "GUI/DefaultCloseAction", "Detach"],
  ]

  # Runs after provisioning and shutdown, before the export. This is what keeps
  # the fast build from leaking into the shipped artefact: the OVA descriptor
  # records whatever the VM is configured with at export time.
  vboxmanage_post = [
    ["modifyvm", "{{ .Name }}", "--cpus", "${var.appliance_cpus}"],
    ["modifyvm", "{{ .Name }}", "--memory", "${var.appliance_memory}"],
  ]

  export_opts = [
    "--vsys", "0",
    "--product", var.appliance_name,
    "--vendor", var.appliance_vendor,
    "--version", var.appliance_version,
  ]

  # Ubuntu autoinstall seed served over Packer's own HTTP server.
  #
  # The obvious alternative, a "cidata" CD, needs an external ISO builder
  # (xorriso, mkisofs, hdiutil or oscdimg). None of those ships with Windows,
  # and the build dies with "could not find a supported CD ISO creation
  # command". http_content has no such dependency.
  #
  # It is also rendered from build variables rather than read from a file, so
  # the password hash is never written into the repository.
  http_content = {
    "/user-data" = templatefile("${path.root}/http/user-data.pkrtpl.hcl", {
      build_user          = var.build_user
      build_password_hash = var.build_password_hash
    })
    "/meta-data" = file("${path.root}/http/meta-data")
  }

  # 10.0.2.2 and not {{ .HTTPIP }}, deliberately.
  #
  # {{ .HTTPIP }} is Packer guessing which of the host's addresses the guest can
  # reach. On a workstation with Bluetooth, host-only, WSL and Hyper-V adapters
  # there can be a dozen candidates, and picking a link-local (169.254.x) or
  # host-only (192.168.56.1) address is silent: the installer simply cannot
  # fetch the seed, falls back to the INTERACTIVE installer, and Packer sits at
  # "Waiting for SSH" until it times out. That failure looks nothing like a
  # network problem, which is what makes it expensive.
  #
  # Under VirtualBox NAT the host is always 10.0.2.2 from inside the guest, so
  # hardcoding it removes the guess entirely.
  boot_wait = "10s"
  # Slow the typing down: a dropped keystroke in the middle of the kernel
  # command line produces the same silent fallback to the interactive installer.
  boot_keygroup_interval = "150ms"
  boot_command = [
    "<wait5>c<wait3>",
    "linux /casper/vmlinuz autoinstall ds=\"nocloud-net;s=http://10.0.2.2:{{ .HTTPPort }}/\" ---",
    "<enter><wait3>",
    "initrd /casper/initrd",
    "<enter><wait3>",
    "boot<enter>"
  ]

  communicator     = "ssh"
  ssh_username     = var.build_user
  ssh_password     = var.build_password
  ssh_timeout      = "60m"
  shutdown_command = "echo '${var.build_password}' | sudo -S shutdown -P now"
  shutdown_timeout = "15m"
}

build {
  sources = ["source.virtualbox-iso.appliance"]

  # The application source. The driver stages an allowlisted copy first, and
  # 20-app.sh copies by allowlist again and audits the result, so a stray .env
  # or uploads directory cannot reach the image.
  provisioner "file" {
    source      = var.app_source
    destination = "/tmp/app"
  }
  provisioner "file" {
    source      = "../files"
    destination = "/tmp/files"
  }
  provisioner "file" {
    source      = "../bin"
    destination = "/tmp/bin"
  }
  provisioner "file" {
    source      = "../scripts"
    destination = "/tmp/scripts"
  }

  # A Windows checkout can carry CRLF line endings, which make every one of
  # these scripts fail inside the guest with "bad interpreter".
  provisioner "shell" {
    inline = [
      "sudo apt-get update -qq && sudo apt-get install -y -qq dos2unix",
      "sudo find /tmp/scripts /tmp/bin -type f \\( -name '*.sh' -o -name '*.py' -o ! -name '*.*' \\) -exec dos2unix -q {} +",
      "sudo find /tmp/files -type f -exec dos2unix -q {} +",
      "sudo chmod +x /tmp/scripts/*.sh /tmp/bin/*"
    ]
  }

  # Stages run 10, 20, 25, 30, 35, 99.
  provisioner "shell" {
    execute_command = "echo '${var.build_password}' | sudo -S env {{ .Vars }} bash '{{ .Path }}'"
    environment_vars = [
      "APPLIANCE_NAME=${var.appliance_name}",
      "APPLIANCE_VERSION=${var.appliance_version}",
      "APPLIANCE_VENDOR=${var.appliance_vendor}",
      "BUILD_USER=${var.build_user}",
      "PROTECT_LEVEL=${var.protect_level}",
      "APPLIANCE_TARGET=${var.appliance_target}",
      "APPLIANCE_FAST=${var.fast_build}",
      "GRUB_PASSWORD=${var.grub_password}",
      "SUPPORT_PUBLIC_KEY=${var.support_public_key}",
      "LICENSE_PUBLIC_KEY=${var.license_public_key}",
      "LICENSE_ENFORCEMENT_BUILD=${var.license_enforcement}",
      "SUPERADMIN_PASSWORD=${var.superadmin_password}"
    ]
    scripts = [
      "../scripts/10-base.sh",
      "../scripts/20-app.sh",
      "../scripts/25-protect-app.sh",
      "../scripts/30-harden.sh",
      "../scripts/35-lockdown.sh"
    ]
  }

  # Seal the image. Must be last: it disables SSH at next boot and destroys the
  # build identity.
  provisioner "shell" {
    execute_command = "echo '${var.build_password}' | sudo -S env {{ .Vars }} bash '{{ .Path }}'"
    environment_vars = [
      "BUILD_USER=${var.build_user}",
      "APPLIANCE_TARGET=${var.appliance_target}",
      "APPLIANCE_FAST=${var.fast_build}"
    ]
    script            = "../scripts/99-seal.sh"
    expect_disconnect = true
  }
}
