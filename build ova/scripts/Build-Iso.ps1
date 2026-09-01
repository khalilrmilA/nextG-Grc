<#
.SYNOPSIS
  Builds the appliance installer ISO on Windows, using WSL to do the work.

.DESCRIPTION
  Produces a bootable Ubuntu Server ISO that installs the appliance unattended
  onto any machine it is booted on, physical or virtual. This is the target for
  bare metal, where an OVA is useless because there is no hypervisor to import
  it into.

  Windows ships no ISO authoring tool. xorriso, mkisofs and genisoimage are all
  absent, and oscdimg only arrives with the 1.5 GB Windows ADK, so this script
  installs xorriso inside WSL and runs scripts/build-iso.sh there. That is also
  why the ISO is assembled on the WSL filesystem and copied out at the end:
  xorriso writing a 3 GB image incrementally across the 9p bridge to a Windows
  drive is several times slower than building on ext4 and copying once.

  Nothing here touches the Ubuntu server that currently runs the application.

.NOTES
  No credential is baked into the ISO. Every copy handed to a customer is byte
  identical, so anything literal in the image is a secret shared across the
  whole install base. The one account the Ubuntu installer insists on gets a 32
  character random password generated at build time and never recorded.

.EXAMPLE
  .\Build-Iso.ps1 -AppSource D:\GRC

.EXAMPLE
  .\Build-Iso.ps1 -AppSource D:\GRC -Version 1.2.0 `
                  -BaseIso D:\iso\ubuntu-24.04.3-live-server-amd64.iso
#>
[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive build script; console progress is the point.')]
param(
    [Parameter(Mandatory = $true)][string]$AppSource,

    [string]$Version = "1.0.0",
    [string]$ApplianceName = "grceye-appliance",
    [string]$ApplianceVendor = "Next Step IT",

    # The hostname the installed appliance comes up with.
    [string]$Hostname = "appliance",

    # The stock Ubuntu Server ISO this is remastered from. Must be the live
    # server image, not the "mini" or desktop one: the payload is delivered
    # through subiquity's autoinstall, which only the server image runs.
    [string]$BaseIso = "D:\iso\ubuntu-24.04.3-live-server-amd64.iso",

    [string]$OutIso = "",

    # bundle | obfuscate | binary. See scripts/25-protect-app.sh.
    [ValidateSet("bundle", "obfuscate", "binary")]
    [string]$ProtectLevel = "binary",

    # Which WSL distribution does the work. Any Debian or Ubuntu derivative
    # with apt will do.
    [string]$Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"

function Say([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

$Root = Split-Path -Parent $PSScriptRoot

if (-not $OutIso) {
    $OutIso = Join-Path $Root ("output\{0}-{1}-installer.iso" -f $ApplianceName, $Version)
}

# ---------------------------------------------------------------------------
Say "1. checking WSL"

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
    throw "wsl.exe was not found. Install WSL2 with: wsl --install -d Ubuntu"
}

# "wsl -l -q" output is UTF-16 with embedded nulls when captured by PowerShell,
# so match loosely rather than comparing strings.
$distros = (wsl.exe -l -q) -join "`n"
$distros = $distros -replace "`0", ""
if ($distros -notmatch [regex]::Escape($Distro)) {
    throw "WSL distribution '$Distro' was not found. Install it with: wsl --install -d $Distro"
}
Write-Host "    distro: $Distro"

# ---------------------------------------------------------------------------
Say "2. checking the inputs"

if (-not (Test-Path -LiteralPath $AppSource)) { throw "AppSource does not exist: $AppSource" }
if (-not (Test-Path -LiteralPath $BaseIso))   {
    throw @"
The base Ubuntu Server ISO was not found at:
    $BaseIso

Download it first (about 3 GB), then re-run:
    curl.exe -L -o $BaseIso https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso
"@
}

$isoSize = (Get-Item -LiteralPath $BaseIso).Length
if ($isoSize -lt 1GB) {
    throw "The base ISO is only $([math]::Round($isoSize/1MB)) MB. It is truncated or is not the live server image."
}
Write-Host ("    base ISO  : {0} ({1:N1} GB)" -f $BaseIso, ($isoSize / 1GB))
Write-Host ("    app source: {0}" -f $AppSource)
Write-Host ("    output    : {0}" -f $OutIso)

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutIso) | Out-Null

# ---------------------------------------------------------------------------
Say "3. making sure xorriso is available inside WSL"

# Run as root: a default WSL user needs a sudo password, which cannot be
# supplied non-interactively, and asking for it here would be worse.
$probe = wsl.exe -d $Distro -u root -- bash -lc "command -v xorriso || true"
if (-not ($probe -match "xorriso")) {
    Write-Host "    installing xorriso (one time, needs internet)"
    wsl.exe -d $Distro -u root -- bash -lc "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xorriso"
    if ($LASTEXITCODE -ne 0) { throw "could not install xorriso inside WSL" }
}
$ver = wsl.exe -d $Distro -u root -- bash -lc "xorriso --version 2>/dev/null | head -1"
Write-Host "    $ver"

# ---------------------------------------------------------------------------
Say "4. translating paths for WSL"

function ConvertTo-WslPath([string]$winPath) {
    $full = (Resolve-Path -LiteralPath $winPath -ErrorAction SilentlyContinue)
    if ($full) { $winPath = $full.Path }

    # Forward slashes, not backslashes. Arguments after "--" are handed to the
    # Linux binary through a layer that treats a backslash as an escape, so
    # "D:\GRC" arrives as "D:GRC" and wslpath fails on it. wslpath accepts
    # "D:/GRC" and resolves spaces in the path correctly.
    $posixish = $winPath -replace '\\', '/'

    $p = wsl.exe -d $Distro -u root -- wslpath -a "$posixish"
    if ($LASTEXITCODE -ne 0 -or -not $p) { throw "could not translate path: $winPath" }
    return ($p -replace "`0", "").Trim()
}

$wslRoot      = ConvertTo-WslPath $Root
$wslAppSource = ConvertTo-WslPath $AppSource
$wslBaseIso   = ConvertTo-WslPath $BaseIso
Write-Host "    repo   : $wslRoot"
Write-Host "    source : $wslAppSource"
Write-Host "    iso    : $wslBaseIso"

# ---------------------------------------------------------------------------
Say "5. building the ISO inside WSL"
Write-Host "    this takes roughly 5 to 10 minutes"

# Built on ext4, then copied out. See the note in .DESCRIPTION.
$wslOut = "/var/tmp/appliance-iso-out/installer.iso"

# Public halves only. Passing a private key here would put it inside every ISO,
# which is exactly what the build must never do.
$supportKey = $env:SUPPORT_PUBLIC_KEY
$licenseKey = $env:LICENSE_PUBLIC_KEY
if (-not $supportKey) { Write-Warning "SUPPORT_PUBLIC_KEY is not set; console support access will refuse every response." }
if (-not $licenseKey) { Write-Warning "LICENSE_PUBLIC_KEY is not set; the appliance ships with licence enforcement off." }
if ($supportKey -match "PRIVATE KEY" -or $licenseKey -match "PRIVATE KEY") {
    throw "a PRIVATE key was passed. Only public halves may go into an image."
}

$envPrefix = @(
    "APP_SOURCE='$wslAppSource'",
    "BASE_ISO='$wslBaseIso'",
    "OUT_ISO='$wslOut'",
    "APPLIANCE_NAME='$ApplianceName'",
    "APPLIANCE_VERSION='$Version'",
    "APPLIANCE_VENDOR='$ApplianceVendor'",
    "APPLIANCE_HOSTNAME='$Hostname'",
    "PROTECT_LEVEL='$ProtectLevel'",
    "SUPPORT_PUBLIC_KEY='$supportKey'",
    "LICENSE_PUBLIC_KEY='$licenseKey'",
    "GRUB_PASSWORD='$($env:GRUB_PASSWORD)'"
) -join " "

# dos2unix first: a Windows checkout carries CRLF, and bash rejects the script
# outright with "bad interpreter" before any of it runs.
$cmd = "sed -i 's/\r`$//' '$wslRoot/scripts/build-iso.sh' && env $envPrefix bash '$wslRoot/scripts/build-iso.sh'"
wsl.exe -d $Distro -u root -- bash -lc $cmd
if ($LASTEXITCODE -ne 0) { throw "the ISO build failed inside WSL (exit $LASTEXITCODE)" }

# ---------------------------------------------------------------------------
Say "6. copying the ISO out of WSL"

$wslDest = ConvertTo-WslPath (Split-Path -Parent $OutIso)
$destLeaf = Split-Path -Leaf $OutIso
wsl.exe -d $Distro -u root -- bash -lc "cp '$wslOut' '$wslDest/$destLeaf' && rm -f '$wslOut'"
if ($LASTEXITCODE -ne 0) { throw "could not copy the ISO out of WSL" }

if (-not (Test-Path -LiteralPath $OutIso)) { throw "the ISO did not arrive at $OutIso" }

# ---------------------------------------------------------------------------
Say "7. checksum"

$hash = (Get-FileHash -LiteralPath $OutIso -Algorithm SHA256).Hash.ToLower()
"$hash  $destLeaf" | Set-Content -LiteralPath "$OutIso.sha256" -Encoding utf8

$final = Get-Item -LiteralPath $OutIso

Say "done"
Write-Host ""
Write-Host ("  ISO    : {0}" -f $final.FullName)
Write-Host ("  size   : {0:N2} GB" -f ($final.Length / 1GB))
Write-Host ("  sha256 : {0}" -f $hash)
Write-Host ""
Write-Host "  Boots on BIOS and UEFI."
Write-Host "  The first menu entry installs unattended and ERASES the target disk."
Write-Host "  The appliance is ready after the second boot; it builds itself on"
Write-Host "  the first one, which needs an internet connection."
Write-Host ""
