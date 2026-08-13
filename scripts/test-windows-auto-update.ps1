param(
	[Parameter(Mandatory = $true)]
	[string]$BaselineInstallerPath,
	[Parameter(Mandatory = $true)]
	[string]$ExpectedVersion,
	[string]$InstallDirectory = "",
	[int]$DownloadTimeoutSeconds = 900,
	[string]$ExpectedPublisher = "",
	[switch]$RequireTargetTimestamp,
	[switch]$AllowUnsigned,
	[switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-HiddenProcess {
	param(
		[Parameter(Mandatory = $true)][string]$FilePath,
		[string[]]$ArgumentList = @()
	)
	$process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru -Wait `
		-WindowStyle Hidden
	if ($process.ExitCode -ne 0) {
		throw "Process failed with exit code $($process.ExitCode): $FilePath"
	}
}

function Get-FreeTcpPort {
	$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
	$listener.Start()
	try {
		return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
	} finally {
		$listener.Stop()
	}
}

function Assert-TargetSignature {
	param(
		[Parameter(Mandatory = $true)][string]$Path,
		[Parameter(Mandatory = $true)][string]$Label
	)
	if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
		if ($RequireTargetTimestamp) {
			throw "-RequireTargetTimestamp requires -ExpectedPublisher"
		}
		return
	}
	$signature = Get-AuthenticodeSignature -FilePath $Path
	if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
		throw "$Label signature gate failed: $($signature.Status)"
	}
	if (-not $signature.SignerCertificate.Subject.Equals(
		$ExpectedPublisher,
		[StringComparison]::OrdinalIgnoreCase
	)) {
		throw "$Label publisher mismatch: $($signature.SignerCertificate.Subject)"
	}
	if ($RequireTargetTimestamp -and -not $signature.TimeStamperCertificate) {
		throw "$Label does not contain a trusted Authenticode timestamp"
	}
	Write-Host "PASS: $Label signature matches $ExpectedPublisher"
	if ($RequireTargetTimestamp) {
		Write-Host "PASS: $Label contains a trusted Authenticode timestamp"
	}
}

function Stop-InstalledProcesses {
	param([Parameter(Mandatory = $true)][string]$Root)
	$resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + `
		[IO.Path]::DirectorySeparatorChar
	$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
		$_.ExecutablePath -and $_.ExecutablePath.StartsWith(
			$resolvedRoot,
			[StringComparison]::OrdinalIgnoreCase
		)
	})
	foreach ($process in $processes) {
		Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
	}
}

function Wait-ForUpdaterInstallers {
	param(
		[Parameter(Mandatory = $true)][string]$Root,
		[int]$TimeoutSeconds = 300
	)
	$resolvedRoot = [IO.Path]::GetFullPath($Root)
	$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
	do {
		$installers = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
			$_.ExecutablePath -and
			$_.ExecutablePath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -and
			$_.Name -match '^Palot-.*-win-x64\.exe$'
		})
		if ($installers.Count -eq 0) {
			return
		}
		Start-Sleep -Seconds 2
	} while ([DateTime]::UtcNow -lt $deadline)
	throw "Automatic update installer did not exit within $TimeoutSeconds seconds"
}

function Assert-SafeAcceptanceRoot {
	param([Parameter(Mandatory = $true)][string]$Path)
	$resolved = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
	$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
		[IO.Path]::DirectorySeparatorChar
	)
	$prefix = "$temp$([IO.Path]::DirectorySeparatorChar)palot-auto-update-"
	if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
		throw "Refusing to remove a directory outside the updater acceptance root: $resolved"
	}
	return $resolved
}

$baselineInstaller = (Get-Item -LiteralPath $BaselineInstallerPath).FullName
if ($RequireTargetTimestamp -and [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
	throw "-RequireTargetTimestamp requires -ExpectedPublisher"
}
$signature = Get-AuthenticodeSignature -FilePath $baselineInstaller
if (
	$signature.Status -ne [Management.Automation.SignatureStatus]::Valid -and
	-not ($AllowUnsigned -and $signature.Status -eq [Management.Automation.SignatureStatus]::NotSigned)
) {
	throw "Baseline installer signature gate failed: $($signature.Status)"
}

$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) `
	"palot-auto-update-$([Guid]::NewGuid().ToString('N'))"
if ([string]::IsNullOrWhiteSpace($InstallDirectory)) {
	$InstallDirectory = Join-Path $acceptanceRoot "Palot Update Install With Spaces"
} else {
	$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
}
$appData = Join-Path $acceptanceRoot "app-data"
$localAppData = Join-Path $acceptanceRoot "local-app-data"
$xdgConfig = Join-Path $acceptanceRoot "xdg-config"
$xdgData = Join-Path $acceptanceRoot "xdg-data"
$userData = Join-Path $acceptanceRoot "electron-user-data"
$xdgSentinel = Join-Path $xdgData "palot/update-preserve-sentinel.txt"
$electronSentinel = Join-Path $userData "update-preserve-sentinel.txt"
$appExecutable = Join-Path $InstallDirectory "Palot.exe"
$driver = (Get-Item -LiteralPath (Join-Path $PSScriptRoot "run-electron-updater-driver.cjs")).FullName
$appProcess = $null
$originalEnvironment = @{
	APPDATA = $env:APPDATA
	LOCALAPPDATA = $env:LOCALAPPDATA
	XDG_CONFIG_HOME = $env:XDG_CONFIG_HOME
	XDG_DATA_HOME = $env:XDG_DATA_HOME
}

try {
	[IO.Directory]::CreateDirectory($acceptanceRoot) | Out-Null
	Invoke-HiddenProcess -FilePath $baselineInstaller -ArgumentList @("/S", "/D=$InstallDirectory")
	if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
		throw "Baseline installer did not create Palot.exe"
	}
	$baselineVersion = (Get-Item -LiteralPath $appExecutable).VersionInfo.FileVersion
	if ($baselineVersion -eq $ExpectedVersion) {
		throw "Baseline version already equals the expected update version"
	}

	[IO.Directory]::CreateDirectory((Split-Path -Parent $xdgSentinel)) | Out-Null
	[IO.Directory]::CreateDirectory($userData) | Out-Null
	[IO.File]::WriteAllText($xdgSentinel, "preserve", [Text.UTF8Encoding]::new($false))
	[IO.File]::WriteAllText($electronSentinel, "preserve", [Text.UTF8Encoding]::new($false))

	$env:APPDATA = $appData
	$env:LOCALAPPDATA = $localAppData
	$env:XDG_CONFIG_HOME = $xdgConfig
	$env:XDG_DATA_HOME = $xdgData
	$port = Get-FreeTcpPort
	$appProcess = Start-Process -FilePath $appExecutable -ArgumentList @(
		"--remote-debugging-port=$port",
		"--remote-allow-origins=*",
		"--user-data-dir=$userData"
	) -PassThru -WindowStyle Hidden

	$discoveryUrl = "http://127.0.0.1:$port/json/list"
	$startupDeadline = [DateTime]::UtcNow.AddSeconds(45)
	do {
		Start-Sleep -Milliseconds 500
		try {
			$targets = @(Invoke-RestMethod -Uri $discoveryUrl -TimeoutSec 2)
		} catch {
			$targets = @()
		}
	} while ($targets.Count -eq 0 -and [DateTime]::UtcNow -lt $startupDeadline)
	if ($targets.Count -eq 0) {
		throw "Palot did not expose its loopback updater acceptance target"
	}

	& node $driver --port $port --version $ExpectedVersion `
		--download-timeout-ms ($DownloadTimeoutSeconds * 1000)
	if ($LASTEXITCODE -ne 0) {
		throw "Electron updater driver failed with exit code $LASTEXITCODE"
	}

	Wait-ForUpdaterInstallers -Root $acceptanceRoot
	$updateDeadline = [DateTime]::UtcNow.AddMinutes(5)
	do {
		Start-Sleep -Seconds 2
		$currentVersion = if (Test-Path -LiteralPath $appExecutable) {
			(Get-Item -LiteralPath $appExecutable).VersionInfo.FileVersion
		} else {
			$null
		}
	} while ($currentVersion -ne $ExpectedVersion -and [DateTime]::UtcNow -lt $updateDeadline)
	if ($currentVersion -ne $ExpectedVersion) {
		throw "Automatic update did not install $ExpectedVersion; current version is $currentVersion"
	}
	Assert-TargetSignature -Path $appExecutable -Label "updated application"
	if (
		-not (Test-Path -LiteralPath $xdgSentinel -PathType Leaf) -or
		-not (Test-Path -LiteralPath $electronSentinel -PathType Leaf)
	) {
		throw "Automatic update removed isolated user data"
	}
	Write-Host "PASS: application updated from $baselineVersion to $ExpectedVersion"
	Write-Host "PASS: automatic update preserved isolated user data"

	Stop-InstalledProcesses -Root $InstallDirectory
	Wait-ForUpdaterInstallers -Root $acceptanceRoot
	Start-Sleep -Seconds 2
	$uninstaller = Get-ChildItem -LiteralPath $InstallDirectory -Filter "Uninstall*.exe" `
		-File | Select-Object -First 1
	if (-not $uninstaller) {
		throw "NSIS uninstaller was not found after the update"
	}
	Assert-TargetSignature -Path $uninstaller.FullName -Label "updated uninstaller"
	Invoke-HiddenProcess -FilePath $uninstaller.FullName -ArgumentList @("/S")
	if (
		-not (Test-Path -LiteralPath $xdgSentinel -PathType Leaf) -or
		-not (Test-Path -LiteralPath $electronSentinel -PathType Leaf)
	) {
		throw "Uninstall after automatic update removed user data"
	}
	Write-Host "PASS: uninstall after automatic update preserved user data"
} finally {
	if ($appProcess -and -not $appProcess.HasExited) {
		Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
	}
	Stop-InstalledProcesses -Root $InstallDirectory
	$env:APPDATA = $originalEnvironment.APPDATA
	$env:LOCALAPPDATA = $originalEnvironment.LOCALAPPDATA
	$env:XDG_CONFIG_HOME = $originalEnvironment.XDG_CONFIG_HOME
	$env:XDG_DATA_HOME = $originalEnvironment.XDG_DATA_HOME
	if (-not $KeepArtifacts -and (Test-Path -LiteralPath $acceptanceRoot)) {
		$safeRoot = Assert-SafeAcceptanceRoot -Path $acceptanceRoot
		for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $safeRoot); $attempt++) {
			try {
				[IO.Directory]::Delete("\\?\$safeRoot", $true)
			} catch {
				Start-Sleep -Seconds 1
			}
		}
		if (Test-Path -LiteralPath $safeRoot) {
			Write-Warning "Unable to remove the updater acceptance root: $safeRoot"
		}
	}
}

Write-Host "Windows automatic update acceptance passed."
