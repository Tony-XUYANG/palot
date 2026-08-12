param(
	[string]$VMName = "Palot Windows 11 Acceptance",
	[string]$StandardUserName = (
		"Palot" + [char]0x6D4B + [char]0x8BD5 + [char]0x7528 + [char]0x6237
	),
	[Parameter(Mandatory = $true)]
	[string]$InstallerPath,
	[Parameter(Mandatory = $true)]
	[string]$PreviousInstallerPath,
	[string]$GuestWorkingDirectory = "C:\Palot Acceptance With Spaces",
	[string]$ReportPath = "",
	[string]$ExpectedPublisher = "",
	[switch]$AllowUnsigned,
	[switch]$RequireTimestamp,
	[switch]$ConsoleCredential
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
	$ReportPath = Join-Path $PSScriptRoot `
		"../.local/windows-acceptance/windows-11-installer-acceptance.json"
}
$resolvedReportPath = [IO.Path]::GetFullPath($ReportPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $resolvedReportPath)) | Out-Null

$installer = Get-Item -LiteralPath $InstallerPath -ErrorAction Stop
$previousInstaller = Get-Item -LiteralPath $PreviousInstallerPath -ErrorAction Stop
$installerTest = Get-Item -LiteralPath (Join-Path $PSScriptRoot "test-windows-installer.ps1") `
	-ErrorAction Stop
$vm = Get-VM -Name $VMName -ErrorAction Stop

if ($vm.State -eq "Off") {
	Start-VM -VM $vm | Out-Null
}

$deadline = [DateTime]::UtcNow.AddMinutes(2)
do {
	Start-Sleep -Seconds 2
	$heartbeat = Get-VMIntegrationService -VMName $VMName | Where-Object {
		$_.Id.EndsWith("84EAAE65-2F2E-45F5-9BB5-0E857DC8EB47")
	}
} while (
	(-not $heartbeat -or -not $heartbeat.PrimaryStatusDescription) -and
	[DateTime]::UtcNow -lt $deadline
)

if ((Get-VM -Name $VMName).State -ne "Running") {
	throw "The Windows 11 VM is not running."
}

$guestInstallerPath = Join-Path $GuestWorkingDirectory $installer.Name
$guestPreviousInstallerPath = Join-Path $GuestWorkingDirectory $previousInstaller.Name
$guestTestPath = Join-Path $GuestWorkingDirectory $installerTest.Name

Write-Host "Copying installers and the acceptance script into the Windows 11 VM..."
Copy-VMFile -VMName $VMName -SourcePath $installer.FullName `
	-DestinationPath $guestInstallerPath -FileSource Host -CreateFullPath -Force
Copy-VMFile -VMName $VMName -SourcePath $previousInstaller.FullName `
	-DestinationPath $guestPreviousInstallerPath -FileSource Host -CreateFullPath -Force
Copy-VMFile -VMName $VMName -SourcePath $installerTest.FullName `
	-DestinationPath $guestTestPath -FileSource Host -CreateFullPath -Force

$credential = if ($ConsoleCredential) {
	$password = Read-Host "Enter the Windows 11 standard-user password" -AsSecureString
	[PSCredential]::new($StandardUserName, $password)
} else {
	Get-Credential -UserName $StandardUserName `
		-Message "Enter the Windows 11 standard-user password. The credential stays in Windows secure memory."
}
if (-not $credential) {
	throw "VM credential entry was cancelled."
}

$startedAt = [DateTimeOffset]::UtcNow
$passed = $false
$errorMessage = $null
$result = $null

try {
	Write-Host "Running the installer acceptance test as a standard user..."
	$result = Invoke-Command -VMName $VMName -Credential $credential -ArgumentList @(
		$guestInstallerPath,
		$guestPreviousInstallerPath,
		$guestTestPath,
		$AllowUnsigned.IsPresent,
		$ExpectedPublisher,
		$RequireTimestamp.IsPresent
	) -ScriptBlock {
		param(
			[string]$InstallerPath,
			[string]$PreviousInstallerPath,
			[string]$InstallerTestPath,
			[bool]$AllowUnsigned,
			[string]$ExpectedPublisher,
			[bool]$RequireTimestamp
		)

		Set-StrictMode -Version Latest
		$ErrorActionPreference = "Stop"
		Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

		$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
		$principal = [Security.Principal.WindowsPrincipal]::new($identity)
		$isAdministrator = $principal.IsInRole(
			[Security.Principal.WindowsBuiltInRole]::Administrator
		)
		if ($isAdministrator) {
			throw "The installer acceptance credential must belong to a standard user."
		}

		$externalCommands = [ordered]@{}
		foreach ($commandName in @("git.exe", "opencode.exe", "docker.exe")) {
			$externalCommands[$commandName] = $null -ne (
				Get-Command $commandName -ErrorAction SilentlyContinue
			)
		}
		if ($externalCommands.Values -contains $true) {
			throw "The clean VM unexpectedly exposes Git, OpenCode, or Docker on PATH."
		}

		$installDirectory = Join-Path $env:LOCALAPPDATA "Palot Install With Spaces"
		$arguments = @{
			InstallerPath = $InstallerPath
			PreviousInstallerPath = $PreviousInstallerPath
			InstallDirectory = $installDirectory
		}
		if ($AllowUnsigned) {
			$arguments.AllowUnsigned = $true
		}
		if (-not [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
			$arguments.ExpectedPublisher = $ExpectedPublisher
		}
		if ($RequireTimestamp) {
			$arguments.RequireTimestamp = $true
		}
		$messages = @(& $InstallerTestPath @arguments *>&1 | ForEach-Object {
			$_.ToString()
		})

		$operatingSystem = Get-CimInstance Win32_OperatingSystem
		$currentInstaller = Get-Item -LiteralPath $InstallerPath
		$baselineInstaller = Get-Item -LiteralPath $PreviousInstallerPath
		[pscustomobject]@{
			operatingSystem = [ordered]@{
				caption = $operatingSystem.Caption
				version = $operatingSystem.Version
				build = $operatingSystem.BuildNumber
				architecture = $operatingSystem.OSArchitecture
			}
			user = [ordered]@{
				name = $identity.Name
				isAdministrator = $isAdministrator
				profilePath = $env:USERPROFILE
			}
			externalCommands = $externalCommands
			installer = [ordered]@{
				fileName = $currentInstaller.Name
				sizeBytes = [int64]$currentInstaller.Length
				sha256 = (Get-FileHash -LiteralPath $currentInstaller.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
			}
			previousInstaller = [ordered]@{
				fileName = $baselineInstaller.Name
				sizeBytes = [int64]$baselineInstaller.Length
				sha256 = (Get-FileHash -LiteralPath $baselineInstaller.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
			}
			installDirectoryHadSpaces = $installDirectory.Contains(" ")
			checks = $messages
		}
	}
	$passed = $true
} catch {
	$errorMessage = $_.Exception.Message
} finally {
	$report = [ordered]@{
		schemaVersion = 1
		startedAt = $startedAt.ToString("o")
		finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
		vmName = $VMName
		passed = $passed
		error = $errorMessage
		result = $result
	}
	[IO.File]::WriteAllText(
		$resolvedReportPath,
		($report | ConvertTo-Json -Depth 8),
		[Text.UTF8Encoding]::new($false)
	)
}

if (-not $passed) {
	throw "Windows 11 installer acceptance failed: $errorMessage"
}

$report | ConvertTo-Json -Depth 8
Write-Host "Windows 11 installer acceptance report: $resolvedReportPath"
