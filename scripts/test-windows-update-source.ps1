param(
	[Parameter(Mandatory = $true)]
	[string]$InstallerPath,
	[Parameter(Mandatory = $true)]
	[string]$ExpectedVersion,
	[string]$ExpectedSource = "china",
	[string]$InstallDirectory = "",
	[string]$ExpectedPublisher = "",
	[switch]$RequireTimestamp,
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

function Assert-AuthenticodeSignature {
	param([Parameter(Mandatory = $true)][string]$Path)
	$signature = Get-AuthenticodeSignature -FilePath $Path
	if ($signature.Status -eq [Management.Automation.SignatureStatus]::Valid) {
		if (
			-not [string]::IsNullOrWhiteSpace($ExpectedPublisher) -and
			-not $signature.SignerCertificate.Subject.Equals(
				$ExpectedPublisher,
				[StringComparison]::OrdinalIgnoreCase
			)
		) {
			throw "Installer publisher mismatch: $($signature.SignerCertificate.Subject)"
		}
		if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
			throw "Installer does not contain a trusted Authenticode timestamp"
		}
		Write-Host "PASS: installer Authenticode signature is valid"
		return
	}
	if ($AllowUnsigned -and $signature.Status -eq [Management.Automation.SignatureStatus]::NotSigned) {
		Write-Host "PASS: unsigned installer explicitly allowed for this prerelease"
		return
	}
	throw "Installer signature gate failed: $($signature.Status)"
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

function Assert-SafeAcceptanceRoot {
	param([Parameter(Mandatory = $true)][string]$Path)
	$resolved = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
	$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
		[IO.Path]::DirectorySeparatorChar
	)
	$prefix = "$temp$([IO.Path]::DirectorySeparatorChar)palot-update-source-"
	if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
		throw "Refusing to remove a directory outside the update-source acceptance root: $resolved"
	}
	return $resolved
}

if ($ExpectedSource -notin @("china", "github")) {
	throw "-ExpectedSource must be china or github"
}
if ($AllowUnsigned -and $RequireTimestamp) {
	throw "-AllowUnsigned and -RequireTimestamp cannot be used together"
}
if (-not $AllowUnsigned -and [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
	throw "Signed installer acceptance requires -ExpectedPublisher"
}

$installer = (Get-Item -LiteralPath $InstallerPath).FullName
Assert-AuthenticodeSignature -Path $installer

$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) `
	"palot-update-source-$([Guid]::NewGuid().ToString('N'))"
if ([string]::IsNullOrWhiteSpace($InstallDirectory)) {
	$InstallDirectory = Join-Path $acceptanceRoot "Palot Update Source With Spaces"
} else {
	$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
}

$appData = Join-Path $acceptanceRoot "app-data"
$localAppData = Join-Path $acceptanceRoot "local-app-data"
$xdgConfig = Join-Path $acceptanceRoot "xdg-config"
$xdgData = Join-Path $acceptanceRoot "xdg-data"
$userData = Join-Path $acceptanceRoot "electron-user-data"
$appExecutable = Join-Path $InstallDirectory "Palot.exe"
$driver = (Get-Item -LiteralPath (
	Join-Path $PSScriptRoot "run-electron-updater-source-driver.cjs"
)).FullName
$appProcess = $null
$originalEnvironment = @{
	APPDATA = $env:APPDATA
	LOCALAPPDATA = $env:LOCALAPPDATA
	XDG_CONFIG_HOME = $env:XDG_CONFIG_HOME
	XDG_DATA_HOME = $env:XDG_DATA_HOME
}

try {
	[IO.Directory]::CreateDirectory($acceptanceRoot) | Out-Null
	Invoke-HiddenProcess -FilePath $installer -ArgumentList @("/S", "/D=$InstallDirectory")
	if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
		throw "Installer did not create Palot.exe"
	}
	$installedVersion = (Get-Item -LiteralPath $appExecutable).VersionInfo.FileVersion
	if ($installedVersion -ne $ExpectedVersion) {
		throw "Installed version mismatch: expected $ExpectedVersion, received $installedVersion"
	}

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
		throw "Palot did not expose its loopback update-source acceptance target"
	}

	& node $driver --port $port --version $ExpectedVersion --source $ExpectedSource
	if ($LASTEXITCODE -ne 0) {
		throw "Electron update-source driver failed with exit code $LASTEXITCODE"
	}
	Write-Host "PASS: packaged updater used $ExpectedSource without fallback"

	Stop-InstalledProcesses -Root $InstallDirectory
	Start-Sleep -Seconds 2
	$uninstaller = Get-ChildItem -LiteralPath $InstallDirectory -Filter "Uninstall*.exe" `
		-File | Select-Object -First 1
	if (-not $uninstaller) {
		throw "NSIS uninstaller was not found"
	}
	Invoke-HiddenProcess -FilePath $uninstaller.FullName -ArgumentList @("/S")
	$uninstallDeadline = [DateTime]::UtcNow.AddSeconds(60)
	while ((Test-Path -LiteralPath $appExecutable) -and [DateTime]::UtcNow -lt $uninstallDeadline) {
		Start-Sleep -Seconds 2
	}
	if (Test-Path -LiteralPath $appExecutable) {
		throw "Silent uninstall did not remove Palot.exe"
	}
	Write-Host "PASS: isolated updater-source installation was removed"
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
			Write-Warning "Unable to remove the update-source acceptance root: $safeRoot"
		}
	}
}

Write-Host "Windows update-source acceptance passed."
