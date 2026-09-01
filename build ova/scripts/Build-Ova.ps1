<#
.SYNOPSIS
  Builds the appliance image on Windows using Packer, with VMware Workstation
  or VirtualBox. Produces an OVA for VMware targets, or a VHD for Hyper-V and
  Azure targets.

.DESCRIPTION
  Nothing touches the Ubuntu server that currently runs the application. This
  script needs only the git repository.

.NOTES
  Build-time credentials are read from the environment, never from parameters.
  A parameter would put them in the PowerShell history, in any transcript, and
  in the process command line. Set these before running:

    $env:BUILD_PASSWORD      = 'build-only-secret'
    $env:BUILD_PASSWORD_HASH = (mkpasswd -m sha-512 output)
    $env:GRUB_PASSWORD       = 'grub-only-secret'

  All three exist only for the duration of the build. 99-seal.sh locks the build
  account before the image is exported, so neither reaches a customer.

.EXAMPLE
  $env:BUILD_PASSWORD='x'; $env:BUILD_PASSWORD_HASH='$6$...'; $env:GRUB_PASSWORD='y'
  .\Build-Ova.ps1 -AppSource D:\GRC -Version 1.0.0

.EXAMPLE
  # First run: watch the autoinstall boot command land on the GRUB menu.
  .\Build-Ova.ps1 -AppSource D:\GRC -Version 1.0.0 -Headless $false
#>
[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive build script; console progress is the point.')]
param(
    [Parameter(Mandatory = $true)][string]$AppSource,
    [string]$Version = "1.0.0",
    [string]$ApplianceName = "grceye-appliance",
    [string]$HardwareVersion = "vmx-15",

    # bundle | obfuscate | binary. See scripts/25-protect-app.sh.
    [ValidateSet("bundle", "obfuscate", "binary")]
    [string]$ProtectLevel = "binary",

    # Which hypervisor builds the image. "vmware" needs VMware Workstation Pro
    # (which bundles ovftool); "virtualbox" needs only VirtualBox, and exports
    # an OVA directly so no ovftool is required.
    [ValidateSet("vmware", "virtualbox")]
    [string]$Hypervisor = "vmware",

    # What the image is being built FOR, which is not the same as what builds
    # it. A Hyper-V image can be built on VirtualBox and converted; only the
    # guest tooling and lockdown profile differ.
    [ValidateSet("vmware", "hyperv", "azure")]
    [string]$Target = "vmware",

    # Test builds only. Skips the apt upgrade (~10 min) and the free-space
    # zeroing (~24 min). The resulting image is NOT shippable: it has the ISO's
    # patch level and compresses badly. It is stamped FAST=1 in
    # /etc/appliance/version so it cannot be mistaken for a release build.
    # Orthogonal to -ProtectLevel, so -Fast still exercises the Nuitka compile.
    [switch]$Fast,

    # Packer aborts an ISO download that takes longer than 30 minutes
    # ("context deadline exceeded"). A 3 GB Ubuntu image over a link slower than
    # about 1.7 MB/s never finishes inside that window, and the deadline is not
    # configurable. Fetch the ISO once with a resumable downloader and pass it
    # here as a file:/// URL with its checksum:
    #
    #   curl.exe -L -C - -o C:\iso\ubuntu-24.04.3-live-server-amd64.iso `
    #     https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-live-server-amd64.iso
    #   (Get-FileHash C:\iso\ubuntu-24.04.3-live-server-amd64.iso -Algorithm SHA256).Hash
    #
    # Leave both empty to let Packer download it.
    [string]$IsoUrl = "",
    [string]$IsoChecksum = "",

    # Public halves only. The private keys stay on vendor infrastructure.
    [string]$SupportPublicKey = "",
    [string]$LicensePublicKey = "",
    [string]$LicenseEnforcement = "True",

    # Run the first build with -Headless $false to watch the autoinstall boot
    # command land on the GRUB menu.
    [bool]$Headless = $true,

    [switch]$SkipOvaFix
)

$ErrorActionPreference = "Stop"

# Build-time credentials, from the environment only. See .NOTES above.
$BuildPassword     = $env:BUILD_PASSWORD
$BuildPasswordHash = $env:BUILD_PASSWORD_HASH
$GrubPassword      = $env:GRUB_PASSWORD
foreach ($pair in @(
    @{ Name = 'BUILD_PASSWORD';      Value = $BuildPassword },
    @{ Name = 'BUILD_PASSWORD_HASH'; Value = $BuildPasswordHash },
    @{ Name = 'GRUB_PASSWORD';       Value = $GrubPassword })) {
    if ([string]::IsNullOrWhiteSpace($pair.Value)) {
        throw "environment variable $($pair.Name) is not set. See Get-Help .\Build-Ova.ps1 -Full"
    }
}
if ($BuildPasswordHash -notmatch '^\$6\$') {
    throw "BUILD_PASSWORD_HASH does not look like a SHA-512 crypt hash (expected it to start with `$6`$). Generate it with: mkpasswd -m sha-512"
}
$Root = Split-Path -Parent $PSScriptRoot
$VmName = "$ApplianceName-$Version"

function Say([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
if ($Fast) {
    Write-Warning "FAST build: apt upgrade and free-space zeroing are skipped."
    Write-Warning "The result is for testing only and must not be shipped."
}

Say "0. preflight"

$ovftool = $null
if ($Hypervisor -eq "vmware") {
    $ovftool = Get-Command ovftool.exe -ErrorAction SilentlyContinue
    if (-not $ovftool) {
        $candidates = @(
            "C:\Program Files\VMware\VMware Workstation\OVFTool\ovftool.exe",
            "C:\Program Files (x86)\VMware\VMware Workstation\OVFTool\ovftool.exe",
            "C:\Program Files\VMware\VMware OVF Tool\ovftool.exe"
        )
        $ovftool = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $ovftool) { throw "ovftool.exe not found. It ships with VMware Workstation Pro." }
    } else { $ovftool = $ovftool.Source }
    Write-Host "ovftool: $ovftool"
} else {
    # VirtualBox exports an OVA itself, and Fix-OvaForEsxi.ps1 uses only tar,
    # so ovftool is not involved on this path.
    $vbox = Get-Command VBoxManage.exe -ErrorAction SilentlyContinue
    if (-not $vbox) {
        $cand = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
        if (Test-Path $cand) {
            $vbox = $cand
            $env:PATH = "$env:PATH;" + (Split-Path -Parent $cand)
        } else { throw "VBoxManage.exe not found. Install VirtualBox or use -Hypervisor vmware." }
    } else { $vbox = $vbox.Source }
    Write-Host "VBoxManage: $vbox"
}

foreach ($c in @("packer", "tar")) {
    if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "missing command: $c" }
}
if (-not (Test-Path $AppSource)) { throw "app source not found: $AppSource" }

# Hyper-V and VMware Workstation share the CPU virtualisation extensions.
# Workstation 17 runs on the Windows Hypervisor Platform, but noticeably slower.
$hv = Get-CimInstance Win32_ComputerSystem
if ($hv.HypervisorPresent) {
    Write-Warning "A Windows hypervisor (Hyper-V, WSL2 or Memory Integrity) is active."
    Write-Warning "The build will still run but more slowly. See WINDOWS-BUILD.md step 2."
    if ($Hypervisor -eq "virtualbox") {
        Write-Warning "VirtualBox falls back to the Windows Hypervisor Platform here, which is"
        Write-Warning "noticeably slower and occasionally refuses to start a VM outright."
    }
}

# ---------------------------------------------------------------------------
Say "1. checking line endings in the checkout"
$crlf = Get-ChildItem -Path (Join-Path $Root "scripts"), (Join-Path $Root "bin") -File |
    Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match "`r`n" }
if ($crlf) {
    Write-Warning "These files have Windows line endings:"
    $crlf | ForEach-Object { Write-Warning "  $($_.Name)" }
    Write-Warning "The build normalises them inside the guest, but fix the repo properly:"
    Write-Warning "  git config core.autocrlf false; git rm --cached -r .; git reset --hard"
}

# ---------------------------------------------------------------------------
Say "2. staging the application source (allowlist)"
# An allowlist, not a blocklist. This repository carries a backend .env with a
# real SECRET_KEY, 69 tracked customer evidence files under backend\uploads, a
# 13 MB client-data database backup and a large virtualenv. Every OVA copy is
# byte identical, so any one of those becomes a shared secret across the whole
# install base.
$stage = Join-Path $Root ".build\appsrc"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "backend") | Out-Null

$required = @(
    "backend\app", "backend\scripts", "backend\appliance_cli.py",
    "backend\requirements.txt", "frameworks", "release\seed\grc_seed.db"
)
foreach ($item in $required) {
    $src = Join-Path $AppSource $item
    if (-not (Test-Path $src)) { throw "missing from the source tree: $item" }
    $dst = Join-Path $stage $item
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item $src $dst -Recurse -Force
}

# The frontend is built inside the guest, so node_modules and any previous dist
# would only slow the upload down. The .env files are excluded because 20-app.sh
# writes its own .env.production inside the guest; carrying a developer's .env
# into the image is exactly the kind of accident the audit below catches.
robocopy (Join-Path $AppSource "frontend") (Join-Path $stage "frontend") /E /NFL /NDL /NJH /NJS /NP /XD node_modules dist .git /XF ".env" ".env.*" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed staging the frontend" }
$global:LASTEXITCODE = 0

# Refuse to build if anything sensitive slipped through the allowlist.
$forbidden = Get-ChildItem $stage -Recurse -Force |
    Where-Object {
        $_.Name -eq ".env" -or $_.Name -like ".env.*" -or
        $_.Extension -in ".log", ".pem", ".key" -or
        $_.Name -eq "uploads" -or $_.Name -eq "venv" -or
        ($_.Extension -eq ".db" -and $_.FullName -notmatch "release.seed")
    }
if ($forbidden) {
    $forbidden | ForEach-Object { Write-Warning "  $($_.FullName)" }
    throw "staging area contains files that must not ship"
}
$stageMb = [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "staging clean: $stageMb MB"

# ---------------------------------------------------------------------------
Say "3. packer build"
Push-Location (Join-Path $Root "packer")
try {
    # Per file, not "packer init .": both templates define local.vm_name, and
    # loading them as one configuration fails with "defined twice".
    $template = if ($Hypervisor -eq "virtualbox") {
        "appliance-virtualbox.pkr.hcl"
    } else {
        "appliance-workstation.pkr.hcl"
    }
    Write-Host "template: $template"

    & packer init $template
    if ($LASTEXITCODE -ne 0) { throw "packer init failed" }

    $headlessArg = $Headless.ToString().ToLower()
    $packerArgs = @(
        "build",
        "-var", "appliance_name=$ApplianceName",
        "-var", "appliance_version=$Version",
        "-var", "app_source=$stage",
        "-var", "build_password=$BuildPassword",
        "-var", "build_password_hash=$BuildPasswordHash",
        "-var", "grub_password=$GrubPassword",
        "-var", "protect_level=$ProtectLevel",
        "-var", "appliance_target=$Target",
        "-var", "fast_build=$(if ($Fast) { '1' } else { '0' })",
        "-var", "support_public_key=$SupportPublicKey",
        "-var", "license_public_key=$LicensePublicKey",
        "-var", "license_enforcement=$LicenseEnforcement",
        "-var", "headless=$headlessArg"
    )
    if ($IsoUrl) {
        if (-not $IsoChecksum) {
            throw "-IsoUrl needs -IsoChecksum. Never build on an unverified base image."
        }
        Write-Host "using a pre-fetched ISO: $IsoUrl"
        $packerArgs += @("-var", "iso_url=$IsoUrl", "-var", "iso_checksum=$IsoChecksum")
    }
    $packerArgs += $template

    & packer $packerArgs
    if ($LASTEXITCODE -ne 0) { throw "packer build failed" }
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# From here the artefact depends on the TARGET, not on which hypervisor built
# it. vmware gets a patched OVA; hyperv and azure get a VHD.
# ---------------------------------------------------------------------------
$outDir = Join-Path $Root "output"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ($Target -ne "vmware") {
    Say "4. converting the built disk to VHD for $Target"
    & (Join-Path $PSScriptRoot "Convert-Disk.ps1") `
        -Target $Target -Version $Version -ApplianceName $ApplianceName
    if ($LASTEXITCODE -ne 0) { throw "disk conversion failed" }

    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    Say "done"
    Get-ChildItem $outDir -Filter "$VmName-$Target.vhd*" |
        Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
        Format-Table -AutoSize | Out-String | Write-Host
    if ($Target -eq "hyperv") {
        Write-Host "Attach to a GENERATION 1 VM. See Convert-Disk.ps1 for why."
    }
    return
}

Say "4. collect the raw OVA"
$rawOva = Join-Path $outDir "$VmName-raw.ova"
Remove-Item $rawOva -ErrorAction SilentlyContinue

if ($Hypervisor -eq "virtualbox") {
    # The builder already exported an OVA; there is nothing to convert.
    $built = Get-ChildItem (Join-Path $Root "output\vbox") -Filter *.ova -Recurse |
        Select-Object -First 1
    if (-not $built) { throw "no .ova produced by packer" }
    Move-Item $built.FullName $rawOva -Force
    Write-Host "raw OVA: $rawOva"
} else {
    $vmx = Get-ChildItem (Join-Path $Root "output\vmx") -Filter *.vmx -Recurse |
        Select-Object -First 1
    if (-not $vmx) { throw "no .vmx produced by packer" }

    & $ovftool --acceptAllEulas --compress=9 --targetType=OVA `
        "--name=$VmName" $vmx.FullName $rawOva
    if ($LASTEXITCODE -ne 0) { throw "ovftool export failed" }
}

# ---------------------------------------------------------------------------
$finalOva = Join-Path $outDir "$VmName.ova"
if ($SkipOvaFix) {
    Say "5. skipping the descriptor patch (no vApp properties will be offered)"
    Move-Item $rawOva $finalOva -Force
} else {
    Say "5. injecting vApp properties and the guestInfo transport"
    & (Join-Path $PSScriptRoot "Fix-OvaForEsxi.ps1") `
        -InputOva $rawOva -OutputOva $finalOva `
        -HardwareVersion $HardwareVersion `
        -ProductSection (Join-Path $Root "ovf\product-section.xml")
    Remove-Item $rawOva -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
Say "6. checksum"
$hash = (Get-FileHash $finalOva -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path -Leaf $finalOva)" | Set-Content "$finalOva.sha256" -Encoding ascii

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

Say "done"
Get-Item $finalOva, "$finalOva.sha256" | Format-Table Name, Length
Write-Host "Verify the import before shipping. See WINDOWS-BUILD.md step 6."
