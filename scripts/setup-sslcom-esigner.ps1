param(
	[string]$Version = "1.0.6",
	[string]$ArchiveSha256 = "e4971440e4ebed94328492cf36e18999554c5c657c856f1cb14a6072c8b1c263",
	[string]$CacheDirectory = "",
	[string]$InstallDirectory = "",
	[string]$ExpectedPublisher = $env:WINDOWS_SIGNING_PUBLISHER,
	[string]$ExpectedThumbprint = $env:WINDOWS_SIGNING_CERT_SHA1,
	[string]$Mode = $env:SSL_COM_ESIGNER_MODE,
	[switch]$PrepareOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RequiredEnvironmentValue {
	param([Parameter(Mandatory = $true)][string]$Name)

	$value = [Environment]::GetEnvironmentVariable($Name)
	if ([string]::IsNullOrWhiteSpace($value)) {
		throw "SSL.com eSigner requires $Name"
	}
	return $value
}

function Assert-TemporaryPath {
	param([Parameter(Mandatory = $true)][string]$Path)

	$resolvedPath = [IO.Path]::GetFullPath($Path)
	$temporaryRoots = @(
		[IO.Path]::GetFullPath([IO.Path]::GetTempPath()),
		$(if ($env:RUNNER_TEMP) { [IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { $null })
	) | Where-Object { $_ }
	foreach ($root in $temporaryRoots) {
		$prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
		if ($resolvedPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
			return $resolvedPath
		}
	}
	throw "Refusing to use an eSigner working path outside a temporary directory: $resolvedPath"
}

function Invoke-QuietProcess {
	param(
		[Parameter(Mandatory = $true)][string]$FilePath,
		[Parameter(Mandatory = $true)][string[]]$Arguments,
		[Parameter(Mandatory = $true)][string]$Label
	)

	$startInfo = [Diagnostics.ProcessStartInfo]::new()
	$startInfo.FileName = $FilePath
	$startInfo.UseShellExecute = $false
	$startInfo.CreateNoWindow = $true
	$startInfo.RedirectStandardOutput = $true
	$startInfo.RedirectStandardError = $true
	foreach ($argument in $Arguments) {
		$startInfo.ArgumentList.Add($argument)
	}
	$process = [Diagnostics.Process]::new()
	$process.StartInfo = $startInfo
	try {
		if (-not $process.Start()) {
			throw "$Label did not start"
		}
		$standardOutput = $process.StandardOutput.ReadToEndAsync()
		$standardError = $process.StandardError.ReadToEndAsync()
		$process.WaitForExit()
		$standardOutput.GetAwaiter().GetResult() | Out-Null
		$standardError.GetAwaiter().GetResult() | Out-Null
		if ($process.ExitCode -ne 0) {
			throw "$Label failed with exit code $($process.ExitCode)"
		}
	} finally {
		$process.Dispose()
	}
}

$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
if ([string]::IsNullOrWhiteSpace($CacheDirectory)) {
	$CacheDirectory = Join-Path $temporaryRoot "palot-esigner-cache"
}
if ([string]::IsNullOrWhiteSpace($InstallDirectory)) {
	$InstallDirectory = Join-Path $temporaryRoot "palot-esigner-cka"
}
$CacheDirectory = Assert-TemporaryPath $CacheDirectory
$InstallDirectory = Assert-TemporaryPath $InstallDirectory
[IO.Directory]::CreateDirectory($CacheDirectory) | Out-Null

$archiveName = "SSL.COM-eSigner-CKA_$Version.zip"
$archivePath = Join-Path $CacheDirectory $archiveName
$downloadUrl = "https://github.com/SSLcom/eSignerCKA/releases/download/v$Version/$archiveName"
if (Test-Path -LiteralPath $archivePath) {
	$cachedHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
	if ($cachedHash -ne $ArchiveSha256.ToLowerInvariant()) {
		Remove-Item -LiteralPath $archivePath -Force
	}
}
if (-not (Test-Path -LiteralPath $archivePath)) {
	Write-Host "Downloading SSL.com eSigner CKA $Version..."
	Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
}
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ArchiveSha256.ToLowerInvariant()) {
	throw "SSL.com eSigner CKA SHA-256 mismatch: $actualHash"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$extractDirectory = Assert-TemporaryPath (Join-Path $InstallDirectory "installer")
if (Test-Path -LiteralPath $extractDirectory) {
	Remove-Item -LiteralPath $extractDirectory -Recurse -Force
}
[IO.Directory]::CreateDirectory($extractDirectory) | Out-Null
$extractPrefix = $extractDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
	foreach ($entry in $archive.Entries) {
		$destination = [IO.Path]::GetFullPath((Join-Path $extractDirectory $entry.FullName))
		if (-not $destination.StartsWith($extractPrefix, [StringComparison]::OrdinalIgnoreCase)) {
			throw "SSL.com eSigner CKA archive contains an unsafe path: $($entry.FullName)"
		}
	}
} finally {
	$archive.Dispose()
}
[IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractDirectory)

$installers = @(Get-ChildItem -LiteralPath $extractDirectory -Filter "*.exe" -File -Recurse)
if ($installers.Count -ne 1) {
	throw "Expected one SSL.com eSigner CKA installer, found $($installers.Count)"
}
$installerSignature = Get-AuthenticodeSignature -LiteralPath $installers[0].FullName
if ($installerSignature.Status -ne "Valid") {
	throw "SSL.com eSigner CKA installer signature is not valid: $($installerSignature.Status)"
}
if (-not $installerSignature.SignerCertificate.Subject.Contains("CN=SSL Corp")) {
	throw "Unexpected SSL.com eSigner CKA installer publisher"
}
Write-Host "Verified SSL.com eSigner CKA $Version ($actualHash)"

if ($PrepareOnly) {
	exit 0
}
if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
	throw "SSL.com eSigner requires WINDOWS_SIGNING_PUBLISHER"
}
$ExpectedPublisher = $ExpectedPublisher.Trim()
if ([string]::IsNullOrWhiteSpace($Mode)) {
	$Mode = "product"
}
if ($Mode -notin @("product", "sandbox")) {
	throw "SSL_COM_ESIGNER_MODE must be product or sandbox"
}

$username = Get-RequiredEnvironmentValue "SSL_COM_USERNAME"
$password = Get-RequiredEnvironmentValue "SSL_COM_PASSWORD"
$totpSecret = Get-RequiredEnvironmentValue "SSL_COM_TOTP_SECRET"
[IO.Directory]::CreateDirectory($InstallDirectory) | Out-Null
Invoke-QuietProcess -FilePath $installers[0].FullName -Label "eSigner CKA installer" -Arguments @(
	"/CURRENTUSER",
	"/VERYSILENT",
	"/SUPPRESSMSGBOXES",
	"/DIR=$InstallDirectory"
)

$toolPath = Join-Path $InstallDirectory "eSignerCKATool.exe"
if (-not (Test-Path -LiteralPath $toolPath)) {
	throw "eSignerCKATool.exe was not installed"
}
$masterKeyPath = Assert-TemporaryPath (Join-Path $InstallDirectory "master.key")
Invoke-QuietProcess -FilePath $toolPath -Label "eSigner CKA account configuration" -Arguments @(
	"config",
	"-mode", $Mode,
	"-user", $username,
	"-pass", $password,
	"-totp", $totpSecret,
	"-key", $masterKeyPath,
	"-r"
)
Invoke-QuietProcess -FilePath $toolPath -Label "eSigner CKA certificate unload" -Arguments @("unload")
Invoke-QuietProcess -FilePath $toolPath -Label "eSigner CKA certificate load" -Arguments @("load")

$certificates = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object {
	$_.NotAfter -gt [DateTime]::UtcNow
})
if (-not [string]::IsNullOrWhiteSpace($ExpectedThumbprint)) {
	$normalizedThumbprint = $ExpectedThumbprint.Replace(" ", "").ToUpperInvariant()
	$certificates = @($certificates | Where-Object { $_.Thumbprint -eq $normalizedThumbprint })
} else {
	$certificates = @($certificates | Where-Object {
		$_.Subject.Equals($ExpectedPublisher, [StringComparison]::OrdinalIgnoreCase)
	})
}
if ($certificates.Count -ne 1) {
	throw "Expected one matching eSigner code-signing certificate, found $($certificates.Count)"
}
$certificate = $certificates[0]
if (-not $certificate.Subject.Equals($ExpectedPublisher, [StringComparison]::OrdinalIgnoreCase)) {
	throw "eSigner certificate publisher mismatch: $($certificate.Subject)"
}
if ($certificate.Thumbprint -notmatch "^[A-Fa-f0-9]{40}$") {
	throw "eSigner returned an invalid certificate thumbprint"
}

Write-Host "Loaded SSL.com eSigner certificate: $($certificate.Subject)"
Write-Host "Certificate expires: $($certificate.NotAfter.ToUniversalTime().ToString("o"))"
if ($env:GITHUB_ENV) {
	Add-Content -LiteralPath $env:GITHUB_ENV -Value "WINDOWS_SIGNING_CERT_SHA1=$($certificate.Thumbprint)"
	Add-Content -LiteralPath $env:GITHUB_ENV -Value "PALOT_ESIGNER_INSTALL_DIR=$InstallDirectory"
	Add-Content -LiteralPath $env:GITHUB_ENV -Value "PALOT_ESIGNER_MASTER_KEY_FILE=$masterKeyPath"
}
