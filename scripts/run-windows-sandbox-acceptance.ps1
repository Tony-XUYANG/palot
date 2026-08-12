param(
	[Parameter(Mandatory = $true)]
	[string]$InstallerPath,
	[string]$PreviousInstallerPath = "",
	[Parameter(Mandatory = $true)]
	[string]$ResultsDirectory,
	[string]$ExpectedPublisher = "",
	[switch]$AllowUnsigned,
	[switch]$RequireTimestamp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-SafeSignatureSummary {
	param([Parameter(Mandatory = $true)][string]$Path)
	$signature = Get-AuthenticodeSignature -FilePath $Path
	return [ordered]@{
		status = $signature.Status.ToString()
		statusMessage = $signature.StatusMessage
		publisher = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
		thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
		timestamped = $null -ne $signature.TimeStamperCertificate
	}
}

$startedAt = [DateTimeOffset]::UtcNow
$resolvedResultsDirectory = [IO.Path]::GetFullPath($ResultsDirectory)
[IO.Directory]::CreateDirectory($resolvedResultsDirectory) | Out-Null
$transcriptPath = Join-Path $resolvedResultsDirectory "sandbox-acceptance.log"
$reportPath = Join-Path $resolvedResultsDirectory "sandbox-acceptance.json"
$passed = $false
$errorMessage = $null

Start-Transcript -Path $transcriptPath -Force | Out-Null
try {
	$installerTest = Join-Path $PSScriptRoot "test-windows-installer.ps1"
	$arguments = @{
		InstallerPath = $InstallerPath
	}
	if (-not [string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
		$arguments.PreviousInstallerPath = $PreviousInstallerPath
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
	& $installerTest @arguments
	$passed = $true
} catch {
	$errorMessage = $_.Exception.Message
	Write-Warning $errorMessage
} finally {
	Stop-Transcript | Out-Null
	$operatingSystem = Get-CimInstance Win32_OperatingSystem
	$installer = Get-Item -LiteralPath $InstallerPath
	$report = [ordered]@{
		schemaVersion = 1
		startedAt = $startedAt.ToString("o")
		finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
		passed = $passed
		error = $errorMessage
		operatingSystem = [ordered]@{
			caption = $operatingSystem.Caption
			version = $operatingSystem.Version
			build = $operatingSystem.BuildNumber
			architecture = $operatingSystem.OSArchitecture
		}
		installer = [ordered]@{
			fileName = $installer.Name
			sizeBytes = [int64]$installer.Length
			sha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
			signature = Get-SafeSignatureSummary -Path $installer.FullName
		}
	}
	$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
}

if (-not $passed) {
	exit 1
}
