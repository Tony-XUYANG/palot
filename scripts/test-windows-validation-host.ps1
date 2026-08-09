param(
	[string]$ReportPath = "",
	[string]$VMRoot = "",
	[switch]$EnableFeatures
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-OptionalFeatureState {
	param([Parameter(Mandatory = $true)][string]$FeatureName)
	try {
		return (Get-WindowsOptionalFeature -Online -FeatureName $FeatureName -ErrorAction Stop).State.ToString()
	} catch {
		return "Unavailable"
	}
}

function Confirm-ExplicitYes {
	param([Parameter(Mandatory = $true)][string]$Message)
	$answer = Read-Host "$Message Type y to continue"
	if ($answer -cne "y") {
		throw "Operation cancelled. No Windows features were changed."
	}
}

function Get-PathDriveFreeBytes {
	param([Parameter(Mandatory = $true)][string]$Path)
	$root = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path))
	$driveName = $root.TrimEnd("\").TrimEnd(":")
	$drive = Get-PSDrive -Name $driveName -PSProvider FileSystem -ErrorAction Stop
	return [int64]$drive.Free
}

function Get-DefaultVMRoot {
	if (Get-PSDrive -Name "D" -PSProvider FileSystem -ErrorAction SilentlyContinue) {
		return "D:\Palot\VirtualMachines"
	}
	return Join-Path $env:ProgramData "Palot/VirtualMachines"
}

$computer = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$hyperVState = Get-OptionalFeatureState -FeatureName "Microsoft-Hyper-V-All"
$sandboxState = Get-OptionalFeatureState -FeatureName "Containers-DisposableClientVM"
$virtualizationEnabled = [bool]$processor.VirtualizationFirmwareEnabled
$hypervisorPresent = [bool]$computer.HypervisorPresent
$secondLevelAddressTranslationReported = [bool]$processor.SecondLevelAddressTranslationExtensions
# Once Hyper-V owns the hardware virtualization extensions, some firmware/WMI combinations report
# the raw SLAT flag as false. A running Windows hypervisor is sufficient evidence that the gate passed.
$secondLevelAddressTranslation = $secondLevelAddressTranslationReported -or $hypervisorPresent
$memoryBytes = [int64]$computer.TotalPhysicalMemory
if ([string]::IsNullOrWhiteSpace($VMRoot)) {
	$VMRoot = Get-DefaultVMRoot
}
$resolvedVMRoot = [IO.Path]::GetFullPath($VMRoot)
$systemDriveFreeBytes = Get-PathDriveFreeBytes -Path $env:SystemDrive
$vmStorageFreeBytes = Get-PathDriveFreeBytes -Path $resolvedVMRoot
$requirements = [ordered]@{
	virtualizationFirmware = $virtualizationEnabled
	secondLevelAddressTranslation = $secondLevelAddressTranslation
	memoryAtLeast8GB = $memoryBytes -ge 8GB
	vmStorageFreeAtLeast90GB = $vmStorageFreeBytes -ge 90GB
	windowsSandboxAvailable = $sandboxState -ne "Unavailable"
	hyperVAvailable = $hyperVState -ne "Unavailable"
}

$featureChange = [ordered]@{
	requested = [bool]$EnableFeatures
	attempted = $false
	restartRequired = $false
}

if ($EnableFeatures) {
	Confirm-ExplicitYes -Message "Enable Hyper-V and Windows Sandbox without restarting?"
	$featureChange.attempted = $true
	$results = @(
		Enable-WindowsOptionalFeature -Online -FeatureName "Microsoft-Hyper-V-All" -All -NoRestart
		Enable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClientVM" -All -NoRestart
	)
	$featureChange.restartRequired = [bool]($results | Where-Object { $_.RestartNeeded })
	$hyperVState = Get-OptionalFeatureState -FeatureName "Microsoft-Hyper-V-All"
	$sandboxState = Get-OptionalFeatureState -FeatureName "Containers-DisposableClientVM"
}

$requirements.hyperVEnabled = $hyperVState -eq "Enabled"
$requirements.windowsSandboxEnabled = $sandboxState -eq "Enabled"
$requirements.sandboxReady =
	$requirements.virtualizationFirmware -and
	$requirements.secondLevelAddressTranslation -and
	$requirements.memoryAtLeast8GB -and
	$requirements.windowsSandboxEnabled
$requirements.hyperVVmReady =
	$requirements.virtualizationFirmware -and
	$requirements.secondLevelAddressTranslation -and
	$requirements.memoryAtLeast8GB -and
	$requirements.vmStorageFreeAtLeast90GB -and
	$requirements.hyperVEnabled

$report = [ordered]@{
	schemaVersion = 1
	generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
	machine = [ordered]@{
		operatingSystem = $operatingSystem.Caption
		version = $operatingSystem.Version
		build = $operatingSystem.BuildNumber
		architecture = $operatingSystem.OSArchitecture
		logicalProcessors = [int]$computer.NumberOfLogicalProcessors
		memoryBytes = $memoryBytes
		systemDriveFreeBytes = $systemDriveFreeBytes
		vmStorageRoot = $resolvedVMRoot
		vmStorageFreeBytes = $vmStorageFreeBytes
	}
	virtualization = [ordered]@{
		firmwareEnabled = $virtualizationEnabled
		hypervisorPresent = $hypervisorPresent
		secondLevelAddressTranslationReported = $secondLevelAddressTranslationReported
		secondLevelAddressTranslationSatisfied = $secondLevelAddressTranslation
		hyperVState = $hyperVState
		windowsSandboxState = $sandboxState
	}
	requirements = $requirements
	featureChange = $featureChange
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
	$ReportPath = Join-Path $PSScriptRoot "../.local/windows-acceptance/host-preflight.json"
}
$resolvedReportPath = [IO.Path]::GetFullPath($ReportPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $resolvedReportPath)) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedReportPath -Encoding utf8

$report | ConvertTo-Json -Depth 6
Write-Host "Host preflight report: $resolvedReportPath"
if ($featureChange.restartRequired) {
	Write-Warning "Windows reported that a restart is required. This script will not restart the computer."
}
