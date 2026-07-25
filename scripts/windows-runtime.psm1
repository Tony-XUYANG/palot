Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-FileSha256 {
	param([Parameter(Mandatory = $true)][string]$Path)

	return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-FileSha256 {
	param(
		[Parameter(Mandatory = $true)][string]$Path,
		[Parameter(Mandatory = $true)][string]$Expected
	)

	$actual = Get-FileSha256 -Path $Path
	if ($actual -ne $Expected.ToLowerInvariant()) {
		throw "SHA-256 mismatch for '$Path'. Expected $Expected, got $actual."
	}
}

function Read-RuntimeManifest {
	param([Parameter(Mandatory = $true)][string]$Path)

	$manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
	if ($manifest.schemaVersion -ne 1 -or $manifest.platform -ne "win32-x64") {
		throw "Unsupported runtime manifest schema or platform: '$Path'."
	}

	foreach ($name in @("opencode", "mingit")) {
		$runtime = $manifest.runtimes.$name
		if (-not $runtime.version -or -not $runtime.url -or -not $runtime.archive -or
			-not $runtime.sha256 -or -not $runtime.extractDirectory -or -not $runtime.executable) {
			throw "Runtime '$name' is incomplete in '$Path'."
		}
		if (-not ([Uri]$runtime.url).Scheme.Equals("https", [StringComparison]::OrdinalIgnoreCase)) {
			throw "Runtime '$name' must use an HTTPS download URL."
		}
		if ($runtime.sha256 -notmatch "^[0-9a-fA-F]{64}$") {
			throw "Runtime '$name' has an invalid SHA-256 value."
		}
	}

	return $manifest
}

function Get-RuntimeArchive {
	param(
		[Parameter(Mandatory = $true)][string]$Uri,
		[Parameter(Mandatory = $true)][string]$CachePath,
		[Parameter(Mandatory = $true)][string]$Sha256,
		[switch]$AllowFileUri
	)

	if (Test-Path -LiteralPath $CachePath) {
		Assert-FileSha256 -Path $CachePath -Expected $Sha256
		Write-Host "Using verified runtime cache: $CachePath"
		return $CachePath
	}

	$parsedUri = [Uri]$Uri
	if (-not $parsedUri.Scheme.Equals("https", [StringComparison]::OrdinalIgnoreCase) -and
		-not ($AllowFileUri -and $parsedUri.IsFile)) {
		throw "Runtime downloads must use HTTPS."
	}

	$cacheParent = Split-Path -Parent $CachePath
	[IO.Directory]::CreateDirectory($cacheParent) | Out-Null
	$tempPath = "$CachePath.download-$([Guid]::NewGuid().ToString('N'))"
	try {
		if ($parsedUri.IsFile) {
			Copy-Item -LiteralPath $parsedUri.LocalPath -Destination $tempPath
		} else {
			Invoke-WebRequest -UseBasicParsing -Uri $parsedUri -OutFile $tempPath
		}
		Assert-FileSha256 -Path $tempPath -Expected $Sha256
		Move-Item -LiteralPath $tempPath -Destination $CachePath
	} finally {
		if (Test-Path -LiteralPath $tempPath) {
			Remove-Item -LiteralPath $tempPath -Force
		}
	}

	return $CachePath
}

function Expand-SecureZip {
	param(
		[Parameter(Mandatory = $true)][string]$ArchivePath,
		[Parameter(Mandatory = $true)][string]$Destination
	)

	Add-Type -AssemblyName System.IO.Compression.FileSystem
	$destinationRoot = [IO.Path]::GetFullPath($Destination)
	$destinationPrefix = $destinationRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) +
		[IO.Path]::DirectorySeparatorChar
	[IO.Directory]::CreateDirectory($destinationRoot) | Out-Null

	$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
	try {
		if ($archive.Entries.Count -gt 100000) {
			throw "ZIP contains too many entries: $($archive.Entries.Count)."
		}

		[long]$totalLength = 0
		foreach ($entry in $archive.Entries) {
			$name = $entry.FullName
			if ([string]::IsNullOrWhiteSpace($name)) {
				continue
			}

			$segments = $name -split "[\\/]"
			if ([IO.Path]::IsPathRooted($name) -or $segments -contains ".." -or $name.Contains(":")) {
				throw "Unsafe ZIP entry path: '$name'."
			}

			$unixFileType = ($entry.ExternalAttributes -shr 16) -band 0xF000
			if ($unixFileType -eq 0xA000) {
				throw "Symbolic links are not allowed in runtime archives: '$name'."
			}

			$totalLength += $entry.Length
			if ($totalLength -gt 2GB) {
				throw "ZIP expands beyond the 2 GB runtime limit."
			}

			$relativePath = $name -replace "[\\/]", [IO.Path]::DirectorySeparatorChar
			$targetPath = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationRoot, $relativePath))
			if (-not $targetPath.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
				throw "ZIP entry escapes its destination: '$name'."
			}

			if ([string]::IsNullOrEmpty($entry.Name)) {
				[IO.Directory]::CreateDirectory($targetPath) | Out-Null
				continue
			}

			[IO.Directory]::CreateDirectory((Split-Path -Parent $targetPath)) | Out-Null
			$inputStream = $entry.Open()
			$outputStream = [IO.File]::Open($targetPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
			try {
				$inputStream.CopyTo($outputStream)
			} finally {
				$outputStream.Dispose()
				$inputStream.Dispose()
			}
		}
	} finally {
		$archive.Dispose()
	}
}

Export-ModuleMember -Function @(
	"Assert-FileSha256",
	"Expand-SecureZip",
	"Get-FileSha256",
	"Get-RuntimeArchive",
	"Read-RuntimeManifest"
)
