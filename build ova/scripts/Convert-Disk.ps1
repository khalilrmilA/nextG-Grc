<#
.SYNOPSIS
  Convert the VirtualBox build output into a VHD for Hyper-V or Azure.

.DESCRIPTION
  The build produces a VMDK. Hyper-V and Azure both want VHD, and Azure is
  strict about how:

    Hyper-V : a dynamic VHD is fine. Attach it to a Generation 1 VM.
    Azure   : the VHD must be FIXED size (not dynamic, not VHDX) and its
              virtual size must be an exact multiple of 1 MB. Azure rejects
              anything else at upload time with an unhelpful error.

  Uses VBoxManage, which is already required to build. No qemu-img, no
  Hyper-V role, so this runs on Windows 11 Home where the hyperv-iso Packer
  builder cannot.

.NOTES
  Generation 1, not Generation 2, on purpose. The image is built with BIOS
  firmware, so it has no EFI system partition and a Generation 2 VM will not
  boot it. If you need Generation 2, the build has to switch to EFI first.

.EXAMPLE
  .\Convert-Disk.ps1 -Target hyperv
  .\Convert-Disk.ps1 -Target azure -Version 1.0.0
#>
[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive build script; console progress is the point.')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("hyperv", "azure")]
    [string]$Target,

    [string]$Version = "1.0.0",
    [string]$ApplianceName = "grceye-appliance",
    [string]$SourceDir,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $SourceDir) { $SourceDir = Join-Path $Root "output\vbox" }
if (-not $OutputDir) { $OutputDir = Join-Path $Root "output" }
$VmName = "$ApplianceName-$Version"

function Say([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

function Invoke-Native {
    <#
      Run a native executable without letting its stderr abort the script.

      VBoxManage writes its progress meter ("0%...10%...") to stderr. Under
      $ErrorActionPreference = "Stop", Windows PowerShell 5.1 wraps each such
      line in a NativeCommandError and turns a perfectly successful conversion
      into a terminating error. Exit code is the only reliable signal, so check
      that instead.
    #>
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments, [string]$What)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host "  $_" }
    } finally {
        $ErrorActionPreference = $prev
    }
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$vbox = Get-Command VBoxManage.exe -ErrorAction SilentlyContinue
if ($vbox) { $vbox = $vbox.Source } else {
    $cand = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
    if (-not (Test-Path $cand)) { throw "VBoxManage.exe not found" }
    $vbox = $cand
}

# ---------------------------------------------------------------------------
Say "1. locating the built disk"
if (-not (Test-Path $SourceDir)) { throw "no build output at $SourceDir" }

$disk = Get-ChildItem $SourceDir -Recurse -Include *.vmdk, *.vdi -File |
    Sort-Object Length -Descending | Select-Object -First 1

if (-not $disk) {
    # The VMware target packages an OVA instead; unpack it to reach the disk.
    $ova = Get-ChildItem $SourceDir -Recurse -Filter *.ova -File | Select-Object -First 1
    if (-not $ova) { throw "no .vmdk, .vdi or .ova found under $SourceDir" }
    Write-Host "  found an OVA, extracting its disk"
    $tmp = Join-Path $env:TEMP ("ovadisk-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Invoke-Native -Exe "tar.exe" -Arguments @("-xf", $ova.FullName, "-C", $tmp) `
        -What "unpacking $($ova.Name)"
    $disk = Get-ChildItem $tmp -Filter *.vmdk -File | Sort-Object Length -Descending | Select-Object -First 1
    if (-not $disk) { throw "no disk inside $($ova.Name)" }
}
Write-Host ("  source: {0}  ({1:N0} MB)" -f $disk.Name, ($disk.Length / 1MB))

# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$vhd = Join-Path $OutputDir "$VmName-$Target.vhd"
Remove-Item $vhd -ErrorAction SilentlyContinue

# Azure requires a fixed-size VHD; Hyper-V is happy with either and a dynamic
# disk keeps the artefact far smaller to move around.
$variant = if ($Target -eq "azure") { "Fixed" } else { "Standard" }

Say "2. converting to VHD ($variant)"
Write-Host "  this rewrites every block and is slow; a 40 GB fixed disk takes a while"
Invoke-Native -Exe $vbox `
    -Arguments @("clonemedium", "disk", $disk.FullName, $vhd, "--format", "VHD", "--variant", $variant) `
    -What "VBoxManage clonemedium"

# clonemedium registers the clone in VirtualBox's media registry. Leaving it
# there makes the next run fail with "already exists in the media registry".
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $vbox closemedium disk $vhd 2>&1 | Out-Null
$ErrorActionPreference = $prev
$global:LASTEXITCODE = 0

$info = Get-Item $vhd
Write-Host ("  wrote {0}  ({1:N0} MB on disk)" -f $info.Name, ($info.Length / 1MB))

# ---------------------------------------------------------------------------
if ($Target -eq "azure") {
    Say "3. Azure preflight"

    # A fixed VHD is a raw image plus a 512 byte footer. Azure requires the
    # VIRTUAL size (file size minus that footer) to be an exact multiple of
    # 1 MB, and rejects the upload otherwise.
    $virtual = $info.Length - 512
    $remainder = $virtual % 1MB
    if ($remainder -eq 0) {
        Write-Host ("  PASS  virtual size {0:N0} MB is 1 MB aligned" -f ($virtual / 1MB))
    } else {
        Write-Warning ("  virtual size is NOT 1 MB aligned (off by {0} bytes)" -f $remainder)
        Write-Warning "  Azure will reject this upload. Adjust disk_size in the Packer"
        Write-Warning "  template to a whole number of MB and rebuild."
    }

    # A dynamic VHD would be silently accepted here and then fail in Azure.
    $fs = [System.IO.File]::Open($vhd, 'Open', 'Read')
    try {
        $fs.Seek(-512, 'End') | Out-Null
        $footer = New-Object byte[] 512
        $fs.Read($footer, 0, 512) | Out-Null
    } finally { $fs.Close() }
    # Disk type lives at offset 60 in the footer, big endian. 2 = fixed, 3 = dynamic.
    $diskType = [int]$footer[63]
    if ($diskType -eq 2) {
        Write-Host "  PASS  footer reports a fixed disk"
    } else {
        Write-Warning "  footer reports disk type $diskType (2 = fixed). Azure needs fixed."
    }

    Write-Host "`n  Upload with:" -ForegroundColor Yellow
    Write-Host "    az storage blob upload --account-name <acct> --container-name vhds ``"
    Write-Host "        --type page --name $VmName.vhd --file `"$vhd`""
    Write-Host "    az image create --name $VmName --os-type Linux ``"
    Write-Host "        --source https://<acct>.blob.core.windows.net/vhds/$VmName.vhd"
} else {
    Say "3. Hyper-V notes"
    Write-Host "  Create a GENERATION 1 VM and attach this VHD to the IDE controller."
    Write-Host "  The image is built with BIOS firmware and has no EFI system"
    Write-Host "  partition, so a Generation 2 VM will not boot it."
    Write-Host "`n  New-VM -Name grceye -Generation 1 -MemoryStartupBytes 4GB ``"
    Write-Host "      -VHDPath `"$vhd`" -SwitchName <your-switch>"
}

# ---------------------------------------------------------------------------
Say "4. checksum"
$hash = (Get-FileHash $vhd -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path -Leaf $vhd)" | Set-Content "$vhd.sha256" -Encoding ascii
Write-Host "  $hash"

Say "done"
Get-Item $vhd, "$vhd.sha256" | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
    Format-Table -AutoSize | Out-String | Write-Host
