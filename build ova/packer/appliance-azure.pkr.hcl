packer {
  required_plugins {
    azure = {
      version = "~> 2.0"
      source  = "github.com/hashicorp/azure"
    }
  }
}

# Azure build path.
#
# This one is different in kind from the other three templates: it builds
# INSIDE your Azure subscription rather than on a local hypervisor. That
# sidesteps the problem that this build host is Windows 11 Home, which cannot
# run Hyper-V, and it removes the VHD upload step entirely because the builder
# captures a managed image directly.
#
# It also starts from a Canonical marketplace image rather than an ISO, so
# there is no autoinstall seed, no boot_command and no GRUB menu timing to get
# right. Those were the source of most of the local build's failures.
#
# The lockdown profile is deliberately weaker here. scripts/35-lockdown.sh
# keeps the serial console, leaves account provisioning to the Azure Linux
# Agent and skips the GRUB password when APPLIANCE_TARGET=azure, because Azure
# boot diagnostics are the only remote recovery path for a guest that will not
# boot. See the comment block in that script.

# ── Credentials ──────────────────────────────────────────────────────────────
# Supply these from the environment, never as literals:
#   $env:ARM_CLIENT_ID / ARM_CLIENT_SECRET / ARM_TENANT_ID / ARM_SUBSCRIPTION_ID
# A service principal with Contributor on the target resource group is enough.

variable "client_id" {
  type      = string
  default   = env("ARM_CLIENT_ID")
  sensitive = true
}

variable "client_secret" {
  type      = string
  default   = env("ARM_CLIENT_SECRET")
  sensitive = true
}

variable "tenant_id" {
  type      = string
  default   = env("ARM_TENANT_ID")
  sensitive = true
}

variable "subscription_id" {
  type      = string
  default   = env("ARM_SUBSCRIPTION_ID")
  sensitive = true
}

# ── Placement ────────────────────────────────────────────────────────────────

variable "location" {
  type    = string
  default = "westeurope"
}

# Standard_D2s_v3 matches the 2 vCPU / 8 GB the appliance is sized for. The
# Nuitka compile is the CPU-bound step; a larger size shortens the build and
# costs nothing extra because the VM is transient.
variable "vm_size" {
  type    = string
  default = "Standard_D4s_v3"
}

variable "managed_image_resource_group_name" {
  type    = string
  default = "grceye-images"
}

# ── Appliance identity ───────────────────────────────────────────────────────

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

variable "app_source" {
  type    = string
  default = "../../.."
}

# bundle | obfuscate | binary. See scripts/25-protect-app.sh.
variable "protect_level" {
  type    = string
  default = "binary"
}

# Unused on Azure: 35-lockdown.sh skips the GRUB password for this target so
# serial console recovery keeps working. Declared so the shared provisioner
# block below can pass it without a separate template.
variable "grub_password" {
  type      = string
  default   = ""
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

locals {
  image_name = "${var.appliance_name}-${var.appliance_version}"
}

source "azure-arm" "appliance" {
  client_id       = var.client_id
  client_secret   = var.client_secret
  tenant_id       = var.tenant_id
  subscription_id = var.subscription_id

  location = var.location
  vm_size  = var.vm_size

  # Start from Canonical's own 24.04 LTS image: same base as the ISO path, but
  # already Azure-ready (walinuxagent, serial console, cloud-init).
  os_type         = "Linux"
  image_publisher = "Canonical"
  image_offer     = "ubuntu-24_04-lts"
  image_sku       = "server"

  # Generation 2 is Azure's default for this SKU and is what the marketplace
  # image is built as. Unlike the local Hyper-V path, nothing here depends on
  # BIOS firmware, so there is no Generation 1 constraint.
  managed_image_name                = local.image_name
  managed_image_resource_group_name = var.managed_image_resource_group_name

  # The transient build VM. Packer deletes the resource group it creates.
  ssh_username = "packer"

  azure_tags = {
    product = var.appliance_name
    version = var.appliance_version
    vendor  = var.appliance_vendor
    built   = "packer"
  }
}

build {
  sources = ["source.azure-arm.appliance"]

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

  # The same five stages as every other target. APPLIANCE_TARGET=azure is what
  # switches the guest tooling and the lockdown profile.
  provisioner "shell" {
    execute_command = "chmod +x {{ .Path }}; sudo -E env {{ .Vars }} bash '{{ .Path }}'"
    environment_vars = [
      "APPLIANCE_NAME=${var.appliance_name}",
      "APPLIANCE_VERSION=${var.appliance_version}",
      "APPLIANCE_VENDOR=${var.appliance_vendor}",
      "BUILD_USER=packer",
      "PROTECT_LEVEL=${var.protect_level}",
      "APPLIANCE_TARGET=azure",
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

  # Seal, then deprovision the Azure agent. 99-seal.sh runs
  # "waagent -force -deprovision+user" as its final action when the target is
  # azure, which is what Azure requires before an image is captured: it removes
  # the provisioning user, its keys and the agent cache so each deployment gets
  # a fresh identity.
  #
  # inline_shebang forces a login-less shell; the deprovision tears down the
  # very account this connection uses, so the disconnect is expected.
  provisioner "shell" {
    execute_command   = "chmod +x {{ .Path }}; sudo -E env {{ .Vars }} bash '{{ .Path }}'"
    environment_vars  = ["BUILD_USER=packer", "APPLIANCE_TARGET=azure"]
    script            = "../scripts/99-seal.sh"
    expect_disconnect = true
    skip_clean        = true
  }
}
