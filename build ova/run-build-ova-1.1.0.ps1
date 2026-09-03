# Build GRCEye appliance OVA 1.1.0 (VirtualBox host -> VMware/ESXi target).
#
# Generated for the 2026-09-03 build. Secrets are set here rather than passed as
# parameters because Build-Ova.ps1 reads them from the environment on purpose:
# a parameter would land in PowerShell history and in any transcript.
#
# 2 vCPU is NOT a conservative guess, it is the only setting that boots on this
# host. VirtualBox falls back to the Windows Hypervisor Platform here (Hyper-V,
# WSL2 and Memory Integrity are all active) and cannot reliably start a
# multi-CPU guest:
#   6 vCPU -> guest kernel RCU stall, VBoxHeadless spins, never boots
#   4 vCPU -> hard freeze at "Loading essential drivers"
#   2 vCPU -> boots immediately
# Raising this does not make the build faster, it makes it never finish.

$ErrorActionPreference = "Stop"

# --- keep the host awake -----------------------------------------------------
# A host that sleeps mid-build kills VirtualBox NAT, and apt then hangs forever
# with no timeout. SetThreadExecutionState, NOT powercfg: powercfg edits the
# user's own power scheme and the edit persists if the build crashes.
Add-Type -Name Power -Namespace Win32 -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
# Written as decimal [uint32], NOT as 0x80000000: PowerShell parses that literal
# as Int32 -2147483648, so the -bor yields a negative number and the call fails
# with "value was too large or too small for a UInt32".
$ES_CONTINUOUS        = [uint32]2147483648  # 0x80000000
$ES_SYSTEM_REQUIRED   = [uint32]1           # 0x00000001
$ES_AWAYMODE_REQUIRED = [uint32]64          # 0x00000040
[void][Win32.Power]::SetThreadExecutionState(
    [uint32]($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_AWAYMODE_REQUIRED))
Write-Host "==> sleep suppressed for the duration of this process"

# --- build-time secrets ------------------------------------------------------
$env:BUILD_PASSWORD      = 'c3354d9dd653d15cd85ae827'
$env:BUILD_PASSWORD_HASH = '$6$0ff051eef75bed35$i4XzrJp3.zVAfmy8WPWIbtqnh9TE4OVhVmGZSeQ/w53x5tOVYaoWu4UmV59bvqEvz5uWlCQLqdYtsa1EJQuKl1'
$env:GRUB_PASSWORD       = 'JbfHqLkITdALHa5IsWr1iNdb!4Rm'

# Fixed platform super-administrator password baked into the image. The console
# shows no credentials at all; the operator arrives already holding this.
$env:SUPERADMIN_PASSWORD = 'GrcEye-69032fb7d654!'

# --- guest sizing ------------------------------------------------------------
# Chosen from what the host actually is, not from a guess, because the two cases
# have opposite right answers and picking wrong costs a whole build.
#
# With a Windows hypervisor active, VirtualBox runs on the Windows Hypervisor
# Platform and cannot reliably start a multi-CPU guest: 6 vCPU stalls the guest
# kernel, 4 freezes it at "Loading essential drivers", only 2 boots. With the
# hypervisor off, VirtualBox gets native VT-x and the template's own defaults
# apply, which is where the Nuitka C compile actually gets fast.
$hypervisorActive = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent

if ($hypervisorActive) {
    $env:PKR_VAR_build_cpus   = '2'
    $env:PKR_VAR_build_memory = '6144'
    Write-Warning "A Windows hypervisor is STILL active (Hyper-V / WSL2 / Memory Integrity)."
    Write-Warning "Falling back to 2 vCPU / 6144 MB, the only setting that boots in this mode."
    Write-Warning "To get the fast build: run as Administrator ->"
    Write-Warning "    bcdedit /set hypervisorlaunchtype off"
    Write-Warning "then reboot. Revert later with: bcdedit /set hypervisorlaunchtype auto"
} else {
    $env:PKR_VAR_build_cpus   = '8'
    $env:PKR_VAR_build_memory = '10240'
    Write-Host "==> No Windows hypervisor: native VT-x available, using 8 vCPU / 10240 MB"
}
Write-Host ("==> guest sized at {0} vCPU / {1} MB" -f $env:PKR_VAR_build_cpus, $env:PKR_VAR_build_memory)

# --- run ---------------------------------------------------------------------
$root = $PSScriptRoot
$log  = Join-Path $root ("build-1.1.0-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Write-Host "==> logging to $log"

& (Join-Path $root "scripts\Build-Ova.ps1") `
    -AppSource         "d:\GRC" `
    -Version           "1.1.0" `
    -Hypervisor        virtualbox `
    -Target            vmware `
    -ProtectLevel      binary `
    -LicensePublicKey  "VR6V3EeeAnz0QC+0BuFfr/NyyfuEE4pkyjcThhCyD2c=" `
    -LicenseEnforcement "True" `
    -Headless          $true 2>&1 | Tee-Object -FilePath $log

$code = $LASTEXITCODE
# Release the sleep suppression rather than leaving it set for this process.
[void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
Write-Host "==> Build-Ova.ps1 exited with $code"
exit $code
