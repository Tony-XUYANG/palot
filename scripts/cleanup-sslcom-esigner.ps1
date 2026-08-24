param(
	[string]$InstallDirectory = $env:PALOT_ESIGNER_INSTALL_DIR,
	[string]$MasterKeyPath = $env:PALOT_ESIGNER_MASTER_KEY_FILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

function Test-IsTemporaryPath {
	param([Parameter(Mandatory = $true)][string]$Path)

	$resolvedPath = [IO.Path]::GetFullPath($Path)
	$temporaryRoots = @(
		[IO.Path]::GetFullPath([IO.Path]::GetTempPath()),
		$(if ($env:RUNNER_TEMP) { [IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { $null })
	) | Where-Object { $_ }
	foreach ($root in $temporaryRoots) {
		$prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
		if ($resolvedPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
			return $true
		}
	}
	return $false
}

if (-not [string]::IsNullOrWhiteSpace($InstallDirectory)) {
	$resolvedInstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
	if (-not (Test-IsTemporaryPath $resolvedInstallDirectory)) {
		throw "Refusing to clean an eSigner directory outside a temporary root"
	}
	$toolPath = Join-Path $resolvedInstallDirectory "eSignerCKATool.exe"
	if (Test-Path -LiteralPath $toolPath) {
		& $toolPath unload *> $null
	}
	$uninstallers = @(Get-ChildItem -LiteralPath $resolvedInstallDirectory -Filter "unins*.exe" `
		-File -ErrorAction SilentlyContinue)
	if ($uninstallers.Count -eq 1) {
		$process = Start-Process -FilePath $uninstallers[0].FullName -ArgumentList @(
			"/VERYSILENT",
			"/SUPPRESSMSGBOXES",
			"/NORESTART"
		) -PassThru -Wait -WindowStyle Hidden
		if ($process.ExitCode -ne 0) {
			Write-Warning "SSL.com eSigner CKA uninstaller exited with code $($process.ExitCode)"
		}
		$process.Dispose()
	}
	if (Test-Path -LiteralPath $resolvedInstallDirectory) {
		Remove-Item -LiteralPath $resolvedInstallDirectory -Recurse -Force
	}
}

if (-not [string]::IsNullOrWhiteSpace($MasterKeyPath)) {
	$resolvedMasterKey = [IO.Path]::GetFullPath($MasterKeyPath)
	if (-not (Test-IsTemporaryPath $resolvedMasterKey)) {
		throw "Refusing to remove an eSigner key outside a temporary root"
	}
	Remove-Item -LiteralPath $resolvedMasterKey -Force -ErrorAction SilentlyContinue
}

if ($env:APPDATA) {
	$appDataRoot = [IO.Path]::GetFullPath($env:APPDATA)
	$eSignerData = [IO.Path]::GetFullPath((Join-Path $appDataRoot "eSignerCKA"))
	$expectedPrefix = $appDataRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
	if ($eSignerData.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
		Remove-Item -LiteralPath $eSignerData -Recurse -Force -ErrorAction SilentlyContinue
	}
}

Write-Host "SSL.com eSigner runner state cleaned up."
