<#
.SYNOPSIS
  Injects vApp properties into an OVA and repacks it correctly.

.DESCRIPTION
  ovftool produces a valid OVA but cannot define vApp properties, so the
  vCenter deploy wizard has nothing to prompt for. This script unpacks the OVA,
  adds the ovf:transport attribute and a ProductSection, regenerates the
  manifest and repacks with the required member ordering: descriptor, manifest,
  then disks.

  Uses only tar.exe, which ships with Windows 10 build 17063 and later.

.EXAMPLE
  .\Fix-OvaForEsxi.ps1 -InputOva raw.ova -OutputOva final.ova `
     -ProductSection ..\ovf\product-section.xml
#>
[CmdletBinding()]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = 'Interactive build script; console progress is the point.')]
param(
    [Parameter(Mandatory = $true)][string]$InputOva,
    [Parameter(Mandatory = $true)][string]$OutputOva,
    [string]$HardwareVersion = "vmx-15",
    [string]$ProductSection
)

$ErrorActionPreference = "Stop"

$InputOva  = (Resolve-Path $InputOva).Path
$OutputOva = [System.IO.Path]::GetFullPath($OutputOva)
if ($ProductSection) { $ProductSection = (Resolve-Path $ProductSection).Path }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("ovafix-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null

try {
    Write-Host "[fix] unpacking $InputOva"
    & tar.exe -xf $InputOva -C $work
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed" }

    $ovf = Get-ChildItem $work -Filter *.ovf | Select-Object -First 1
    if (-not $ovf) { throw "no .ovf descriptor inside the OVA" }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($ovf.Name)

    Write-Host "[fix] rewriting the descriptor"
    $xml = Get-Content $ovf.FullName -Raw

    # Some producers still write a non-VMware hardware family.
    $xml = [regex]::Replace($xml,
        "(<vssd:VirtualSystemType>)[^<]*(</vssd:VirtualSystemType>)",
        "`${1}$HardwareVersion`${2}")

    # Strip any VirtualBox extension block.
    $xml = [regex]::Replace($xml, "<vbox:Machine.*?</vbox:Machine>", "",
        [System.Text.RegularExpressions.RegexOptions]::Singleline)

    # Strip hardware ESXi has no device for. VirtualBox adds a sound card to
    # every VM it exports, and ESXi does not ignore it, it refuses the whole
    # upload:
    #
    #   OVF hardware element 'ResourceType' with instance ID '6':
    #   No support for the virtual hardware device type '35'
    #
    # ResourceType 35 is an audio adapter; 23 is a USB controller, which older
    # ESXi builds reject the same way. The appliance has no use for either.
    $unsupported = @{ 35 = "sound card"; 23 = "USB controller" }
    foreach ($rt in $unsupported.Keys) {
        $pattern = "(?s)[ \t]*<Item>(?:(?!</Item>).)*?<rasd:ResourceType>$rt</rasd:ResourceType>.*?</Item>\r?\n?"
        $before = $xml.Length
        $xml = [regex]::Replace($xml, $pattern, "")
        if ($xml.Length -ne $before) {
            Write-Host "[fix] removed the $($unsupported[$rt]) (ResourceType $rt), which ESXi refuses"
        }
    }
    if ($xml -match "<rasd:ResourceType>35</rasd:ResourceType>") {
        throw "a sound card survived the strip; ESXi would reject this OVA"
    }

    # Let the guest read vApp properties through VMware Tools.
    if ($xml -notmatch 'ovf:transport=') {
        $xml = [regex]::Replace($xml, "<VirtualHardwareSection>",
            '<VirtualHardwareSection ovf:transport="com.vmware.guestInfo">', 1)
    }

    # Inject the vApp properties.
    #
    # The obvious guard, "only if the descriptor has no ProductSection", is
    # WRONG and silently produced OVAs with no deploy form at all. Both
    # VirtualBox and ovftool already write a ProductSection of their own when
    # --product/--vendor/--version are passed:
    #
    #   <ProductSection>
    #     <Info>Meta-information about the installed software</Info>
    #     <Product>grceye-appliance</Product>
    #     <Vendor>Next Step IT</Vendor>
    #     <Version>1.0.0</Version>
    #   </ProductSection>
    #
    # That section carries no <Property> elements, so vCenter shows the operator
    # nothing to fill in. Skipping on its presence means the appliance ships
    # unconfigurable, which is only discovered at a customer site.
    #
    # So: REPLACE any existing section (ours carries Product/Vendor/Version too),
    # and only fall back to inserting before </VirtualSystem> when there is none.
    # The real "already done" test is whether our properties are present.
    if ($ProductSection) {
        $section = Get-Content $ProductSection -Raw
        $section = [regex]::Replace($section, "<!--.*?-->", "",
            [System.Text.RegularExpressions.RegexOptions]::Singleline).Trim()

        if ($section -notmatch "<ProductSection") {
            Write-Warning "[fix] $ProductSection has no <ProductSection>; skipping"
        } elseif ($xml -match 'ovf:key="net_mode"') {
            Write-Host "[fix] vApp properties already present, leaving them alone"
        } else {
            $existing = [regex]"(?s)<ProductSection.*?</ProductSection>"
            if ($existing.IsMatch($xml)) {
                $xml = $existing.Replace($xml, $section, 1)
                Write-Host "[fix] vApp properties injected (replaced the exporter's stub section)"
            } else {
                $rx = [regex]"</VirtualSystem>"
                $xml = $rx.Replace($xml, ($section + "`n</VirtualSystem>"), 1)
                Write-Host "[fix] vApp properties injected"
            }
        }

        $n = ([regex]::Matches($xml, 'ovf:key="')).Count
        if ($n -lt 1) {
            throw "vApp property injection produced no properties; vCenter would offer no deploy form"
        }
        Write-Host "[fix] $n vApp properties in the descriptor"
    }

    # LF endings and no BOM; some importers are strict about the descriptor.
    $xml = $xml -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($ovf.FullName, $xml,
        (New-Object System.Text.UTF8Encoding($false)))

    Write-Host "[fix] regenerating the manifest"
    Get-ChildItem $work -Include *.mf, *.cert -Recurse | Remove-Item -Force
    $mfPath = Join-Path $work "$base.mf"
    $lines = @()
    $members = @($ovf.Name) + (Get-ChildItem $work -Filter *.vmdk | ForEach-Object { $_.Name })
    foreach ($m in $members) {
        $h = (Get-FileHash (Join-Path $work $m) -Algorithm SHA256).Hash.ToLower()
        $lines += "SHA256($m)= $h"
    }
    [System.IO.File]::WriteAllText($mfPath, (($lines -join "`n") + "`n"),
        (New-Object System.Text.ASCIIEncoding))

    Write-Host "[fix] repacking"
    Remove-Item $OutputOva -ErrorAction SilentlyContinue
    Push-Location $work
    try {
        # Order matters: descriptor, manifest, then disks.
        $ordered = @($ovf.Name, "$base.mf") +
                   (Get-ChildItem . -Filter *.vmdk | ForEach-Object { $_.Name })
        & tar.exe -cf $OutputOva --format=ustar $ordered
        if ($LASTEXITCODE -ne 0) { throw "tar repack failed" }
    } finally { Pop-Location }

    Write-Host "[fix] wrote $OutputOva"
    & tar.exe -tf $OutputOva
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
