packer {
  required_plugins {
    vsphere = {
      version = ">= 1.4.0"
      source  = "github.com/hashicorp/vsphere"
    }
  }
}

variable "vcenter_server" { type = string }
variable "vcenter_user" { type = string }
variable "vcenter_password" {
  type      = string
  sensitive = true
}
variable "datacenter" { type = string }
variable "cluster" { type = string }
variable "datastore" { type = string }
variable "network" { type = string }
variable "iso_path" { type = string } # e.g. "[datastore1] iso/ubuntu-24.04.2-live-server-amd64.iso"

variable "appliance_name" {
  type    = string
  default = "grceye-appliance"
}
variable "appliance_version" {
  type    = string
  default = "1.0.0"
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
variable "build_password_hash" {
  type      = string
  sensitive = true
}

variable "appliance_vendor" {
  type    = string
  default = "Next Step IT"
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

# Path to your application source tree (the repo you build from).
variable "app_source" {
  type    = string
  default = "../../.."
}

locals {
  vm_name = "${var.appliance_name}-${var.appliance_version}"
}

source "vsphere-iso" "appliance" {
  vcenter_server      = var.vcenter_server
  username            = var.vcenter_user
  password            = var.vcenter_password
  insecure_connection = true

  datacenter = var.datacenter
  cluster    = var.cluster
  datastore  = var.datastore

  vm_name       = local.vm_name
  guest_os_type = "ubuntu64Guest"
  # vm_version 15 = ESXi 6.7 U2 and later. Raise it only if every target host is newer.
  vm_version = 15
  firmware   = "efi"

  CPUs                 = 2
  cpu_cores            = 1
  RAM                  = 4096
  RAM_reserve_all      = false
  disk_controller_type = ["pvscsi"]

  storage {
    disk_size             = 40960
    disk_thin_provisioned = true
  }

  network_adapters {
    network      = var.network
    network_card = "vmxnet3"
  }

  iso_paths = [var.iso_path]

  # Ubuntu autoinstall seed delivered as a "cidata" CD-ROM.
  # Rendered from build variables so no credential is committed. The scaffold
  # shipped "$6$rounds=4096$REPLACE$ME" here, which fails the install.
  #
  # This template keeps the CD rather than http_content, unlike the local
  # builders: a guest running on an ESXi host often cannot reach the Packer HTTP
  # server on the operator's workstation, while the CD is uploaded to the
  # datastore and is always reachable. It does mean this template needs xorriso
  # or mkisofs on the build host, which is fine on Linux and absent on Windows.
  cd_content = {
    "user-data" = templatefile("${path.root}/http/user-data.pkrtpl.hcl", {
      build_user          = var.build_user
      build_password_hash = var.build_password_hash
    })
    "meta-data" = file("${path.root}/http/meta-data")
  }
  cd_label = "cidata"

  # NOTE: this boot_command is tied to the GRUB menu of the exact ISO you use.
  # Verify it interactively once before running an unattended build.
  boot_wait = "5s"
  boot_command = [
    "<wait5>c<wait3>",
    "linux /casper/vmlinuz autoinstall ds=nocloud;s=/cdrom/ ---",
    "<enter><wait3>",
    "initrd /casper/initrd",
    "<enter><wait3>",
    "boot<enter>"
  ]

  ip_wait_timeout  = "30m"
  ssh_username     = var.build_user
  ssh_password     = var.build_password
  ssh_timeout      = "40m"
  shutdown_command = "echo '${var.build_password}' | sudo -S shutdown -P now"
  shutdown_timeout = "10m"

  export {
    output_directory = "../output"
    force            = true
    name             = local.vm_name
  }
}

build {
  sources = ["source.vsphere-iso.appliance"]

  # 1. Application payload
  provisioner "file" {
    source      = var.app_source
    destination = "/tmp/app"
  }

  # 2. Appliance runtime files
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

  # A Windows checkout can carry CRLF line endings, which make every script
  # fail inside the guest with "bad interpreter".
  provisioner "shell" {
    inline = [
      "sudo apt-get update -qq && sudo apt-get install -y -qq dos2unix",
      "sudo find /tmp/scripts /tmp/bin -type f -exec dos2unix -q {} +",
      "sudo find /tmp/files -type f -exec dos2unix -q {} +",
      "sudo chmod +x /tmp/scripts/*.sh /tmp/bin/*"
    ]
  }

  # 3. Build, install, harden. Stages run 10, 20, 25, 30, 35, 99; 25 and 35 were
  #    written but never wired in, which was defect 5.
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

  # 4. Seal the image. Must be last: it disables SSH at next boot and destroys
  #    the build identity.
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
