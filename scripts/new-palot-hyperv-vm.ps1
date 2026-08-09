param(
	[string]$VMName = "Palot Windows 11 Acceptance",
	[string]$IsoPath = "",
	[string]$VMRoot = "",
	[switch]$Create,
	[switch]$CreateCleanCheckpoint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Create -and $CreateCleanCheckpoint) {
	throw "Use -Create and -CreateCleanCheckpoint in separate runs."
}

function Confirm-ExplicitYes {
	param([Parameter(Mandatory = $true)][string]$Message)
	$answer = Read-Host "$Message Type y to continue"
	if ($answer -cne "y") {
		throw "Operation cancelled. Hyper-V was not changed."
	}
}

function Get-DefaultVMRoot {
	if (Get-PSDrive -Name "D" -PSProvider FileSystem -ErrorAction SilentlyContinue) {
		return "D:\Palot\VirtualMachines"
	}
	return Join-Path $env:ProgramData "Palot/VirtualMachines"
}

function Get-PathDriveFreeBytes {
	param([Parameter(Mandatory = $true)][string]$Path)
	$root = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path))
	$driveName = $root.TrimEnd("\").TrimEnd(":")
	return [int64](Get-PSDrive -Name $driveName -PSProvider FileSystem -ErrorAction Stop).Free
}

if ([string]::IsNullOrWhiteSpace($VMRoot)) {
	$VMRoot = Get-DefaultVMRoot
}
$resolvedRoot = [IO.Path]::GetFullPath($VMRoot)
$vhdPath = Join-Path $resolvedRoot "$VMName.vhdx"
$vmStorageFreeBytes = Get-PathDriveFreeBytes -Path $resolvedRoot
$configuration = [ordered]@{
	name = $VMName
	generation = 2
	processorCount = 4
	dynamicMemory = $true
	memoryStartupBytes = 4GB
	memoryMinimumBytes = 4GB
	memoryMaximumBytes = 8GB
	vhdSizeBytes = 80GB
	switchName = "Default Switch"
	secureBoot = $true
	vmRoot = $resolvedRoot
	vmStorageFreeBytes = $vmStorageFreeBytes
	vhdPath = $vhdPath
	isoPath = if ([string]::IsNullOrWhiteSpace($IsoPath)) { $null } else { [IO.Path]::GetFullPath($IsoPath) }
	mode = if ($Create) { "create" } elseif ($CreateCleanCheckpoint) { "checkpoint" } else { "dry-run" }
}

$configuration | ConvertTo-Json -Depth 4
if (-not $Create -and -not $CreateCleanCheckpoint) {
	Write-Host "Dry run only. Use -Create or -CreateCleanCheckpoint to request a change."
	exit 0
}

$hyperVState = (Get-WindowsOptionalFeature -Online -FeatureName "Microsoft-Hyper-V-All").State
if ($hyperVState -ne "Enabled") {
	throw "Hyper-V is not enabled. Run the host preflight before creating a VM."
}
Import-Module Hyper-V -ErrorAction Stop

if ($Create) {
	if ([string]::IsNullOrWhiteSpace($IsoPath)) {
		throw "-IsoPath is required when creating the VM."
	}
	$resolvedIso = (Get-Item -LiteralPath $IsoPath).FullName
	if (Get-VM -Name $VMName -ErrorAction SilentlyContinue) {
		throw "A VM named '$VMName' already exists."
	}
	if (Test-Path -LiteralPath $vhdPath) {
		throw "The target VHDX already exists: $vhdPath"
	}
	if (-not (Get-VMSwitch -Name "Default Switch" -ErrorAction SilentlyContinue)) {
		throw "The Hyper-V Default Switch was not found."
	}
	if ($vmStorageFreeBytes -lt 90GB) {
		throw "The VM storage drive must have at least 90 GB free before creating the dynamic 80 GB VHDX."
	}
	Confirm-ExplicitYes -Message "Create the Hyper-V VM '$VMName'?"
	[IO.Directory]::CreateDirectory($resolvedRoot) | Out-Null
	$vm = New-VM -Name $VMName -Generation 2 -MemoryStartupBytes 4GB `
		-NewVHDPath $vhdPath -NewVHDSizeBytes 80GB -Path $resolvedRoot -SwitchName "Default Switch"
	Set-VMProcessor -VM $vm -Count 4
	Set-VMMemory -VM $vm -DynamicMemoryEnabled $true -StartupBytes 4GB `
		-MinimumBytes 4GB -MaximumBytes 8GB
	Set-VMFirmware -VM $vm -EnableSecureBoot On
	$dvd = Add-VMDvdDrive -VM $vm -Path $resolvedIso -Passthru
	Set-VMFirmware -VM $vm -FirstBootDevice $dvd
	Write-Host "VM created. Install Windows, apply updates, then shut it down before creating the clean checkpoint."
}

if ($CreateCleanCheckpoint) {
	$vm = Get-VM -Name $VMName -ErrorAction Stop
	if ($vm.State -ne "Off") {
		throw "Shut down '$VMName' before creating the clean checkpoint."
	}
	Confirm-ExplicitYes -Message "Create the clean checkpoint for '$VMName'?"
	Checkpoint-VM -VM $vm -SnapshotName "Clean Windows - before Palot"
	Write-Host "Clean checkpoint created."
}
