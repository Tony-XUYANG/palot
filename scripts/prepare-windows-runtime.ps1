param(
	[string]$ManifestPath,
	[string]$CacheDirectory,
	[string]$Destination
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ManifestPath) {
	$ManifestPath = Join-Path $repoRoot "apps/desktop/runtime-manifest.json"
}
if (-not $CacheDirectory) {
	$CacheDirectory = if ($env:PALOT_RUNTIME_CACHE_DIR) {
		$env:PALOT_RUNTIME_CACHE_DIR
	} else {
		Join-Path $repoRoot ".cache/windows-runtime"
	}
}
if (-not $Destination) {
	$Destination = Join-Path $repoRoot "apps/desktop/resources/runtime/win32-x64"
}

Import-Module (Join-Path $PSScriptRoot "windows-runtime.psm1") -Force
$manifest = Read-RuntimeManifest -Path $ManifestPath
$staging = "$Destination.staging-$([Guid]::NewGuid().ToString('N'))"
$backup = "$Destination.backup-$([Guid]::NewGuid().ToString('N'))"

try {
	[IO.Directory]::CreateDirectory($staging) | Out-Null
	foreach ($runtimeName in @("opencode", "mingit")) {
		$runtime = $manifest.runtimes.$runtimeName
		$cachePath = Join-Path $CacheDirectory "$($runtime.version)-$($runtime.archive)"
		$archivePath = Get-RuntimeArchive -Uri $runtime.url -CachePath $cachePath -Sha256 $runtime.sha256
		$extractPath = Join-Path $staging $runtime.extractDirectory
		Write-Host "Extracting $runtimeName $($runtime.version)..."
		Expand-SecureZip -ArchivePath $archivePath -Destination $extractPath
	}

	foreach ($runtimeName in @("opencode", "mingit")) {
		$executable = Join-Path $staging $manifest.runtimes.$runtimeName.executable
		if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
			throw "Runtime '$runtimeName' is missing its executable: '$executable'."
		}
	}

	$licenses = Join-Path $staging "licenses"
	[IO.Directory]::CreateDirectory($licenses) | Out-Null
	Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $licenses "palot-MIT.txt")
	Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD-PARTY-NOTICES.md") -Destination $licenses
	Copy-Item -Path (Join-Path $repoRoot "apps/desktop/resources/runtime-licenses/*") -Destination $licenses
	Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $staging "runtime-manifest.json")

	if (Test-Path -LiteralPath $Destination) {
		Move-Item -LiteralPath $Destination -Destination $backup
	}
	try {
		Move-Item -LiteralPath $staging -Destination $Destination
	} catch {
		if (Test-Path -LiteralPath $backup) {
			Move-Item -LiteralPath $backup -Destination $Destination
		}
		throw
	}
	if (Test-Path -LiteralPath $backup) {
		Remove-Item -LiteralPath $backup -Recurse -Force
	}

	Write-Host "Windows runtimes are ready at: $Destination"
} finally {
	if (Test-Path -LiteralPath $staging) {
		Remove-Item -LiteralPath $staging -Recurse -Force
	}
}
