param(
	[string]$VMName = "Palot Windows 11 Acceptance",
	[Parameter(Mandatory = $true)]
	[string]$AdminUserName,
	[string]$StandardUserName = (
		"Palot" + [char]0x6D4B + [char]0x8BD5 + [char]0x7528 + [char]0x6237
	),
	[string]$ReportPath = "",
	[switch]$ConsoleCredential
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
	$ReportPath = Join-Path $PSScriptRoot "../.local/windows-acceptance/windows-11-initialization.json"
}
$resolvedReportPath = [IO.Path]::GetFullPath($ReportPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $resolvedReportPath)) | Out-Null

$vm = Get-VM -Name $VMName -ErrorAction Stop
if ($vm.State -ne "Running") {
	throw "The Windows VM must be running before initialization."
}

$credential = if ($ConsoleCredential) {
	$password = Read-Host "Enter the local Windows 11 VM password" -AsSecureString
	[PSCredential]::new($AdminUserName, $password)
} else {
	Get-Credential -UserName $AdminUserName `
		-Message "Enter the local Windows 11 VM password. The credential stays in Windows secure memory."
}
if (-not $credential) {
	throw "VM credential entry was cancelled."
}

Write-Host "Connecting to the Windows 11 VM and scanning for updates..."
$result = Invoke-Command -VMName $VMName -Credential $credential -ArgumentList @(
	$StandardUserName,
	$credential.Password
) -ScriptBlock {
	param(
		[string]$StandardUserName,
		[SecureString]$StandardUserPassword
	)

	Set-StrictMode -Version Latest
	$ErrorActionPreference = "Stop"
	$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
	$principal = [Security.Principal.WindowsPrincipal]::new($identity)
	if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
		throw "The VM credential must belong to a local administrator."
	}

	$usersGroup = Get-LocalGroup -SID "S-1-5-32-545"
	$administratorsGroup = Get-LocalGroup -SID "S-1-5-32-544"
	$user = Get-LocalUser -Name $StandardUserName -ErrorAction SilentlyContinue
	if (-not $user) {
		$user = New-LocalUser -Name $StandardUserName -Password $StandardUserPassword `
			-AccountNeverExpires -PasswordNeverExpires -Description "Palot standard-user acceptance account"
	}
	$usersMembers = @(Get-LocalGroupMember -Group $usersGroup.Name -ErrorAction SilentlyContinue)
	if ($usersMembers.Name -notcontains "$env:COMPUTERNAME\$StandardUserName") {
		Add-LocalGroupMember -Group $usersGroup.Name -Member $user
	}
	$adminMembers = @(Get-LocalGroupMember -Group $administratorsGroup.Name -ErrorAction SilentlyContinue)
	if ($adminMembers.Name -contains "$env:COMPUTERNAME\$StandardUserName") {
		Remove-LocalGroupMember -Group $administratorsGroup.Name -Member $user
	}

	$update = [ordered]@{
		scanSucceeded = $false
		available = 0
		downloadResultCode = $null
		installResultCode = $null
		installed = 0
		failed = 0
		rebootRequired = $false
		error = $null
	}
	try {
		$session = New-Object -ComObject "Microsoft.Update.Session"
		$searcher = $session.CreateUpdateSearcher()
		$search = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
		$update.scanSucceeded = $true
		$update.available = [int]$search.Updates.Count
		$selected = New-Object -ComObject "Microsoft.Update.UpdateColl"
		foreach ($candidate in $search.Updates) {
			if (-not $candidate.EulaAccepted) {
				$candidate.AcceptEula()
			}
			[void]$selected.Add($candidate)
		}
		if ($selected.Count -gt 0) {
			$downloader = $session.CreateUpdateDownloader()
			$downloader.Updates = $selected
			$download = $downloader.Download()
			$update.downloadResultCode = [int]$download.ResultCode

			$installer = $session.CreateUpdateInstaller()
			$installer.Updates = $selected
			$installation = $installer.Install()
			$update.installResultCode = [int]$installation.ResultCode
			$update.rebootRequired = [bool]$installation.RebootRequired
			for ($index = 0; $index -lt $selected.Count; $index++) {
				$itemResult = $installation.GetUpdateResult($index)
				if ([int]$itemResult.ResultCode -in @(2, 3)) {
					$update.installed++
				} else {
					$update.failed++
				}
			}
		}
	} catch {
		$update.error = $_.Exception.Message
	}

	$operatingSystem = Get-CimInstance Win32_OperatingSystem
	$standardUser = Get-LocalUser -Name $StandardUserName
	$standardUserIsAdmin = @(
		Get-LocalGroupMember -Group $administratorsGroup.Name -ErrorAction SilentlyContinue
	).Name -contains "$env:COMPUTERNAME\$StandardUserName"

	[pscustomobject]@{
		operatingSystem = [ordered]@{
			caption = $operatingSystem.Caption
			version = $operatingSystem.Version
			build = $operatingSystem.BuildNumber
			architecture = $operatingSystem.OSArchitecture
		}
		standardUser = [ordered]@{
			name = $standardUser.Name
			enabled = [bool]$standardUser.Enabled
			isAdministrator = [bool]$standardUserIsAdmin
		}
		windowsUpdate = $update
	}
}

$report = [ordered]@{
	schemaVersion = 1
	generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
	vmName = $VMName
	operatingSystem = $result.operatingSystem
	standardUser = $result.standardUser
	windowsUpdate = $result.windowsUpdate
}
[IO.File]::WriteAllText(
	$resolvedReportPath,
	($report | ConvertTo-Json -Depth 7),
	[Text.UTF8Encoding]::new($false)
)
$report | ConvertTo-Json -Depth 7
Write-Host "VM initialization report: $resolvedReportPath"

if ($result.windowsUpdate.rebootRequired) {
	Write-Host "Restarting the Windows 11 VM to finish updates..."
	Stop-VM -VM $vm -Force
	Start-VM -VM $vm | Out-Null
}
