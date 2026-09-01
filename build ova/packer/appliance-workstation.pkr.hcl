packer {
  required_plugins {
    vmware = {
      # Pinned inside 1.x on purpose. The 2.x plugin refuses any hardware
      # version below 19 ("minimum hardware version: 19"), which would force
      # the appliance above the vmx-15 ESXi 6.7 Update 2 floor. ">= 1.1.0"
      # resolves to the newest 2.x and fails validation.
      version = "~> 1.1"
      source  = "github.com/hashicorp/vmware"
    }
  }
}

variable "iso_url" {
  type    = string
  default = "https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-live-server-amd64.iso"
}

# How to obtain this, and why it is not a literal here:
#
# Canonical publishes a signed SHA256SUMS file next to every ISO. Packer can
# read that file directly and match the entry for the ISO it just downloaded,
# so the checksum is fetched from the authoritative source at build time rather
# than pasted in by hand and then quietly going stale on the next point
# release. This replaces the scaffold's
# "sha256:REPLACE_WITH_THE_CHECKSUM_FROM_UBUNTU_SHA256SUMS" placeholder.
#
# To pin a literal instead (an air-gapped build host, or a checksum you have
# verified against Canonical's GPG signature yourself):
#
#   curl -LO https://releases.ubuntu.com/24.04.3/SHA256SUMS
#   curl -LO https://releases.ubuntu.com/24.04.3/SHA256SUMS.gpg
#   gpg --keyserver keyserver.ubuntu.com \
#       --recv-keys 843938DF228D22F7B3742BC0D94AA3F0EFE21092
#   gpg --verify SHA256SUMS.gpg SHA256SUMS
#   grep live-server-amd64 SHA256SUMS
#
# then pass -var 'iso_checksum=sha256:<the value>'.
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

# SHA-512 crypt hash of build_password, for the autoinstall seed.
# Generate with: mkpasswd -m sha-512
# No default: a placeholder here is what broke the scaffold's install.
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

# Public half of the support signing keypair, from tools/sign-challenge keygen.
# The private half stays on vendor infrastructure and must never appear here.
variable "support_public_key" {
  type    = string
  default = ""
}

# Public half of the licence signing keypair. Baked into build_info.py before
# compilation so a customer cannot swap it through the environment.
variable "license_public_key" {
  type    = string
  default = ""
}

variable "license_enforcement" {
  type    = string
  default = "True"
}

variable "headless" {
  type    = bool
  default = true
}

locals {
  vm_name = "${var.appliance_name}-${var.appliance_version}"
}

source "vmware-iso" "appliance" {
  vm_name          = local.vm_name
  output_directory = "../output/vmx"
  # Run the first build with -var 'headless=false' so the autoinstall boot
  # command can be watched landing on the GRUB menu.
  headless = var.headless

  iso_url      = var.iso_url
  iso_checksum = var.iso_checksum

  guest_os_type = "ubuntu-64"
  # Hardware version 15 = ESXi 6.7 Update 2 and later. Raising this locks out
  # older hosts, which is the most common import failure at customer sites.
  version = 15

  cpus      = 2
  cores     = 1
  memory    = 4096
  disk_size = 40960

  disk_type_id         = "0"
  disk_adapter_type    = "lsisas1068"
  network_adapter_type = "vmxnet3"
  network              = "nat"
  sound                = false
  usb                  = false

  vmx_data = {
    "firmware"              = "bios"
    "mks.enable3d"          = "FALSE"
    "floppy0.present"       = "FALSE"
    "ethernet0.addressType" = "generated"
  }

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

  # Tied to the GRUB menu of the exact ISO. Run one build with headless = false
  # the first time so you can watch the keystrokes land.
  boot_wait = "5s"
  boot_command = [
    "<wait5>c<wait3>",
    "linux /casper/vmlinuz autoinstall ds=\"nocloud-net;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/\" ---",
    "<enter><wait3>",
    "initrd /casper/initrd",
    "<enter><wait3>",
    "boot<enter>"
  ]

  communicator     = "ssh"
  ssh_username     = var.build_user
  ssh_password     = var.build_password
  ssh_timeout      = "45m"
  shutdown_command = "echo '${var.build_password}' | sudo -S shutdown -P now"
  shutdown_timeout = "10m"
}

build {
  sources = ["source.vmware-iso.appliance"]

  # The application source. build-ova-local.sh and Build-Ova.ps1 stage an
  # allowlisted copy first; 20-app.sh copies by allowlist again and audits the
  # result, so a stray .env or uploads directory cannot reach the image.
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
  # these scripts fail inside the guest with "bad interpreter". Normalise them
  # here so the build does not depend on the developer's git configuration.
  provisioner "shell" {
    inline = [
      "sudo apt-get update -qq && sudo apt-get install -y -qq dos2unix",
      "sudo find /tmp/scripts /tmp/bin -type f \\( -name '*.sh' -o -name '*.py' -o ! -name '*.*' \\) -exec dos2unix -q {} +",
      "sudo find /tmp/files -type f -exec dos2unix -q {} +",
      "sudo chmod +x /tmp/scripts/*.sh /tmp/bin/*"
    ]
  }

  # Stages run 10, 20, 25, 30, 35, 99. 25 and 35 were written but never wired
  # in, which was defect 5.
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
      "LICENSE_ENFORCEMENT_BUILD=${var.license_enforcement}"
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
