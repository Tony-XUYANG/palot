param(
	[Parameter(Mandatory = $true)]
	[string]$InstallerPath,
	[string]$PreviousInstallerPath = "",
	[string]$InstallDirectory = "",
	[switch]$AllowUnsigned,
	[switch]$SkipLaunch,
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

function Assert-CommandVersion {
	param(
		[Parameter(Mandatory = $true)][string]$FilePath,
		[Parameter(Mandatory = $true)][string[]]$ArgumentList,
		[Parameter(Mandatory = $true)][string]$Expected
	)
	$output = (& $FilePath @ArgumentList 2>&1 | Out-String).Trim()
	if ($LASTEXITCODE -ne 0 -or -not $output.Contains($Expected)) {
		throw "Bundled runtime check failed for $FilePath. Output: $output"
	}
	Write-Host "PASS: $Expected"
}

function Get-DescendantProcessIds {
	param([Parameter(Mandatory = $true)][int]$ParentId)
	$ids = [Collections.Generic.List[int]]::new()
	$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" `
		-ErrorAction SilentlyContinue)
	foreach ($child in $children) {
		foreach ($descendant in @(Get-DescendantProcessIds -ParentId $child.ProcessId)) {
			$ids.Add($descendant)
		}
		$ids.Add([int]$child.ProcessId)
	}
	return $ids.ToArray()
}

function Stop-SmokeProcessTree {
	param([Diagnostics.Process]$Process)
	if (-not $Process -or $Process.HasExited) {
		return
	}
	$ids = @(Get-DescendantProcessIds -ParentId $Process.Id)
	[array]::Reverse($ids)
	foreach ($id in $ids) {
		Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
	}
	Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
}

function Stop-SmokeRelatedProcesses {
	param(
		[Parameter(Mandatory = $true)][string]$SmokeRoot,
		[Parameter(Mandatory = $true)][string]$InstallDirectory
	)
	# Windows can create the firewall notification process shortly after Palot exits.
	# Poll briefly so the smoke test does not leave that delayed process behind.
	for ($attempt = 0; $attempt -lt 5; $attempt++) {
		$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
			$_.ProcessId -ne $PID -and (
				($_.ExecutablePath -and $_.ExecutablePath.StartsWith(
					$InstallDirectory,
					[StringComparison]::OrdinalIgnoreCase
				)) -or
				($_.CommandLine -and $_.CommandLine.Contains($SmokeRoot))
			)
		})
		foreach ($process in $processes) {
			Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
		}
		Start-Sleep -Milliseconds 500
	}
}

function Assert-SafeSmokeRoot {
	param([Parameter(Mandatory = $true)][string]$Path)
	$resolved = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
	$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
		[IO.Path]::DirectorySeparatorChar
	)
	$prefix = "$temp$([IO.Path]::DirectorySeparatorChar)palot-installer-smoke-"
	if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
		throw "Refusing to remove a directory outside the installer smoke root: $resolved"
	}
	return $resolved
}

$installer = (Get-Item -LiteralPath $InstallerPath).FullName
$initialInstaller = $installer
if (-not [string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
	$initialInstaller = (Get-Item -LiteralPath $PreviousInstallerPath).FullName
}
$signature = Get-AuthenticodeSignature -FilePath $installer
if ($signature.Status -eq [Management.Automation.SignatureStatus]::Valid) {
	Write-Host "PASS: installer Authenticode signature is valid"
} elseif ($AllowUnsigned -and $signature.Status -eq [Management.Automation.SignatureStatus]::NotSigned) {
	Write-Host "PASS: unsigned installer explicitly allowed for this prerelease"
} else {
	throw "Installer signature gate failed: $($signature.Status)"
}

$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) `
	"palot-installer-smoke-$([Guid]::NewGuid().ToString('N'))"
$usesDefaultInstallDirectory = [string]::IsNullOrWhiteSpace($InstallDirectory)
if ($usesDefaultInstallDirectory) {
	$InstallDirectory = Join-Path $smokeRoot "Palot Install With Spaces"
} else {
	$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
}

$xdgConfig = Join-Path $smokeRoot "xdg-config"
$xdgData = Join-Path $smokeRoot "xdg-data"
$appData = Join-Path $smokeRoot "app-data"
$localAppData = Join-Path $smokeRoot "local-app-data"
$userData = Join-Path $smokeRoot "electron-user-data"
$sentinel = Join-Path $xdgData "palot/preserve-sentinel.txt"
$userDataSentinel = Join-Path $userData "preserve-sentinel.txt"
$appProcess = $null
$originalEnvironment = @{
	APPDATA = $env:APPDATA
	LOCALAPPDATA = $env:LOCALAPPDATA
	PATH = $env:PATH
	XDG_CONFIG_HOME = $env:XDG_CONFIG_HOME
	XDG_DATA_HOME = $env:XDG_DATA_HOME
}

try {
	[IO.Directory]::CreateDirectory($smokeRoot) | Out-Null
	$installArguments = @("/S", "/D=$InstallDirectory")
	Invoke-HiddenProcess -FilePath $initialInstaller -ArgumentList $installArguments

	$appExecutable = Join-Path $InstallDirectory "Palot.exe"
	[IO.Directory]::CreateDirectory((Split-Path -Parent $sentinel)) | Out-Null
	[IO.Directory]::CreateDirectory($userData) | Out-Null
	[IO.File]::WriteAllText($sentinel, "preserve", [Text.UTF8Encoding]::new($false))
	[IO.File]::WriteAllText($userDataSentinel, "preserve", [Text.UTF8Encoding]::new($false))

	# Upgrade from the requested baseline, or reinstall the same package when no baseline is supplied.
	Invoke-HiddenProcess -FilePath $installer -ArgumentList $installArguments
	if (-not (Test-Path -LiteralPath $appExecutable -PathType Leaf)) {
		throw "Upgrade install removed the application executable"
	}
	if (
		-not (Test-Path -LiteralPath $sentinel -PathType Leaf) -or
		-not (Test-Path -LiteralPath $userDataSentinel -PathType Leaf)
	) {
		throw "Upgrade install removed isolated user data"
	}
	$upgradeLabel = if ($initialInstaller -eq $installer) { "same-version upgrade" } else { "version upgrade" }
	Write-Host "PASS: silent $upgradeLabel preserved user data"

	$runtimeRoot = Join-Path $InstallDirectory "resources/runtime"
	$manifestPath = Join-Path $runtimeRoot "runtime-manifest.json"
	foreach ($required in @(
		$appExecutable,
		$manifestPath,
		(Join-Path $runtimeRoot "licenses/THIRD-PARTY-NOTICES.md"),
		(Join-Path $runtimeRoot "licenses/THIRD-PARTY-SOURCE-OFFER.txt")
	)) {
		if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
			throw "Installed file is missing after upgrade: $required"
		}
	}

	$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
	$openCodePath = Join-Path $runtimeRoot $manifest.runtimes.opencode.executable
	$gitPath = Join-Path $runtimeRoot $manifest.runtimes.mingit.executable
	$githubPath = Join-Path $runtimeRoot $manifest.runtimes.github.executable
	$kubectlPath = Join-Path $runtimeRoot $manifest.runtimes.kubectl.executable

	$env:PATH = ""
	Assert-CommandVersion -FilePath $openCodePath -ArgumentList @("--version") `
		-Expected $manifest.runtimes.opencode.version
	$gitVersion = $manifest.runtimes.mingit.version -replace `
		'^(\d+\.\d+\.\d+)\.(\d+)$', '$1.windows.$2'
	Assert-CommandVersion -FilePath $gitPath -ArgumentList @("--version") -Expected $gitVersion
	Assert-CommandVersion -FilePath $githubPath -ArgumentList @("--version") `
		-Expected $manifest.runtimes.github.version
	Assert-CommandVersion -FilePath $kubectlPath -ArgumentList @("version", "--client=true") `
		-Expected $manifest.runtimes.kubectl.version

	if (-not $SkipLaunch) {
		$env:APPDATA = $appData
		$env:LOCALAPPDATA = $localAppData
		$env:XDG_CONFIG_HOME = $xdgConfig
		$env:XDG_DATA_HOME = $xdgData
		$appProcess = Start-Process -FilePath $appExecutable `
			-ArgumentList @("--user-data-dir=$userData") -PassThru -WindowStyle Hidden
		Start-Sleep -Seconds 15
		if ($appProcess.HasExited) {
			throw "Installed Palot exited during the launch smoke test"
		}
		Write-Host "PASS: installed Palot stayed running for 15 seconds"
		Stop-SmokeProcessTree -Process $appProcess
		$appProcess = $null
		Start-Sleep -Seconds 2
	}

	$uninstaller = Get-ChildItem -LiteralPath $InstallDirectory -Filter "Uninstall*.exe" `
		-File | Select-Object -First 1
	if (-not $uninstaller) {
		throw "NSIS uninstaller was not found"
	}
	Invoke-HiddenProcess -FilePath $uninstaller.FullName -ArgumentList @("/S")
	$deadline = [DateTime]::UtcNow.AddSeconds(60)
	while ((Test-Path -LiteralPath $appExecutable) -and [DateTime]::UtcNow -lt $deadline) {
		Start-Sleep -Seconds 2
	}
	if (Test-Path -LiteralPath $appExecutable) {
		throw "Silent uninstall did not remove Palot.exe"
	}
	if (
		-not (Test-Path -LiteralPath $sentinel -PathType Leaf) -or
		-not (Test-Path -LiteralPath $userDataSentinel -PathType Leaf)
	) {
		throw "Uninstall removed user data"
	}
	Write-Host "PASS: silent uninstall preserved user data"
} finally {
	if ($appProcess) {
		Stop-SmokeProcessTree -Process $appProcess
	}
	$env:APPDATA = $originalEnvironment.APPDATA
	$env:LOCALAPPDATA = $originalEnvironment.LOCALAPPDATA
	$env:PATH = $originalEnvironment.PATH
	$env:XDG_CONFIG_HOME = $originalEnvironment.XDG_CONFIG_HOME
	$env:XDG_DATA_HOME = $originalEnvironment.XDG_DATA_HOME
	if (-not $KeepArtifacts -and (Test-Path -LiteralPath $smokeRoot)) {
		Stop-SmokeRelatedProcesses -SmokeRoot $smokeRoot -InstallDirectory $InstallDirectory
		Start-Sleep -Seconds 1
		$safeRoot = Assert-SafeSmokeRoot -Path $smokeRoot
		$extendedRoot = "\\?\$safeRoot"
		for ($attempt = 0; $attempt -lt 5 -and (Test-Path -LiteralPath $safeRoot); $attempt++) {
			try {
				[IO.Directory]::Delete($extendedRoot, $true)
			} catch {
				Start-Sleep -Seconds 1
			}
		}
		if (Test-Path -LiteralPath $safeRoot) {
			throw "Unable to remove the installer smoke directory: $safeRoot"
		}
		Stop-SmokeRelatedProcesses -SmokeRoot $smokeRoot -InstallDirectory $InstallDirectory
	}
}

Write-Host "Windows installer smoke test passed."
