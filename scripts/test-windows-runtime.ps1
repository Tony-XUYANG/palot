Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "windows-runtime.psm1") -Force
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-Throws {
	param([Parameter(Mandatory = $true)][scriptblock]$Action, [Parameter(Mandatory = $true)][string]$Name)
	try {
		& $Action
	} catch {
		Write-Host "PASS: $Name"
		return
	}
	throw "Expected failure: $Name"
}

$root = Join-Path ([IO.Path]::GetTempPath()) "palot-runtime-test-$([Guid]::NewGuid().ToString('N'))"
try {
	[IO.Directory]::CreateDirectory($root) | Out-Null
	$source = Join-Path $root "source.zip"
	$zip = [IO.Compression.ZipFile]::Open($source, [IO.Compression.ZipArchiveMode]::Create)
	$entry = $zip.CreateEntry("bin/tool.exe")
	$writer = [IO.StreamWriter]::new($entry.Open())
	$writer.Write("runtime")
	$writer.Dispose()
	$zip.Dispose()

	$sha = Get-FileSha256 -Path $source
	$cache = Join-Path $root "cache/runtime.zip"
	Get-RuntimeArchive -Uri ([Uri]$source).AbsoluteUri -CachePath $cache -Sha256 $sha -AllowFileUri | Out-Null
	Get-RuntimeArchive -Uri ([Uri]$source).AbsoluteUri -CachePath $cache -Sha256 $sha -AllowFileUri | Out-Null
	Write-Host "PASS: verified and reused cache"

	Assert-Throws -Name "wrong SHA" -Action {
		Get-RuntimeArchive -Uri ([Uri]$source).AbsoluteUri -CachePath (Join-Path $root "wrong.zip") `
			-Sha256 ("0" * 64) -AllowFileUri | Out-Null
	}

	Set-Content -LiteralPath $cache -Value "corrupt"
	Assert-Throws -Name "corrupt cache" -Action {
		Get-RuntimeArchive -Uri ([Uri]$source).AbsoluteUri -CachePath $cache -Sha256 $sha -AllowFileUri | Out-Null
	}

	$corruptZip = Join-Path $root "corrupt.zip"
	Set-Content -LiteralPath $corruptZip -Value "not a zip"
	Assert-Throws -Name "corrupt ZIP" -Action {
		Expand-SecureZip -ArchivePath $corruptZip -Destination (Join-Path $root "corrupt-out")
	}

	$traversalZip = Join-Path $root "traversal.zip"
	$zip = [IO.Compression.ZipFile]::Open($traversalZip, [IO.Compression.ZipArchiveMode]::Create)
	$entry = $zip.CreateEntry("../escape.txt")
	$writer = [IO.StreamWriter]::new($entry.Open())
	$writer.Write("escape")
	$writer.Dispose()
	$zip.Dispose()
	Assert-Throws -Name "ZIP path traversal" -Action {
		Expand-SecureZip -ArchivePath $traversalZip -Destination (Join-Path $root "traversal-out")
	}
	if (Test-Path -LiteralPath (Join-Path $root "escape.txt")) {
		throw "Traversal archive wrote outside the destination."
	}

	Write-Host "Windows runtime tests passed."
} finally {
	if (Test-Path -LiteralPath $root) {
		Remove-Item -LiteralPath $root -Recurse -Force
	}
}
