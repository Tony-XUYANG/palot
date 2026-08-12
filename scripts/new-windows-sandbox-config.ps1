param(
	[Parameter(Mandatory = $true)]
	[string]$InstallerPath,
	[string]$PreviousInstallerPath = "",
	[string]$OutputPath = "",
	[string]$ResultsDirectory = "",
	[string]$ExpectedPublisher = "",
	[switch]$AllowUnsigned,
	[switch]$RequireTimestamp,
	[switch]$Launch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-XmlText {
	param([Parameter(Mandatory = $true)][string]$Value)
	return [Security.SecurityElement]::Escape($Value)
}

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$scriptsRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$installer = (Get-Item -LiteralPath $InstallerPath).FullName
$installerDirectory = Split-Path -Parent $installer
$installerName = Split-Path -Leaf $installer
if (-not [string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
	$previousInstaller = (Get-Item -LiteralPath $PreviousInstallerPath).FullName
	if ((Split-Path -Parent $previousInstaller) -ne $installerDirectory) {
		throw "The current and previous installers must be in the same mapped directory."
	}
}

if ([string]::IsNullOrWhiteSpace($ResultsDirectory)) {
	$ResultsDirectory = Join-Path $workspaceRoot ".local/windows-acceptance/sandbox"
}
$resolvedResults = [IO.Path]::GetFullPath($ResultsDirectory)
[IO.Directory]::CreateDirectory($resolvedResults) | Out-Null

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
	$OutputPath = Join-Path $resolvedResults "palot-acceptance.wsb"
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $resolvedOutput)) | Out-Null

$arguments = @(
	"-NoProfile",
	"-ExecutionPolicy", "Bypass",
	"-File", "C:\PalotScripts\run-windows-sandbox-acceptance.ps1",
	"-InstallerPath", "C:\PalotInstallers\$installerName",
	"-ResultsDirectory", "C:\PalotResults"
)
if (-not [string]::IsNullOrWhiteSpace($PreviousInstallerPath)) {
	$arguments += @("-PreviousInstallerPath", "C:\PalotInstallers\$(Split-Path -Leaf $PreviousInstallerPath)")
}
if ($AllowUnsigned) {
	$arguments += "-AllowUnsigned"
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
	$arguments += @("-ExpectedPublisher", $ExpectedPublisher)
}
if ($RequireTimestamp) {
	$arguments += "-RequireTimestamp"
}
$command = "powershell.exe " + (($arguments | ForEach-Object { '"' + $_.Replace('"', '`"') + '"' }) -join " ")

$xml = @"
<Configuration>
  <Networking>Default</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$(ConvertTo-XmlText $scriptsRoot)</HostFolder>
      <SandboxFolder>C:\PalotScripts</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$(ConvertTo-XmlText $installerDirectory)</HostFolder>
      <SandboxFolder>C:\PalotInstallers</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$(ConvertTo-XmlText $resolvedResults)</HostFolder>
      <SandboxFolder>C:\PalotResults</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>$(ConvertTo-XmlText $command)</Command>
  </LogonCommand>
</Configuration>
"@

[IO.File]::WriteAllText($resolvedOutput, $xml, [Text.UTF8Encoding]::new($false))
Write-Host "Windows Sandbox configuration: $resolvedOutput"
Write-Host "Acceptance results directory: $resolvedResults"

if ($Launch) {
	$state = (Get-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClientVM").State
	if ($state -ne "Enabled") {
		throw "Windows Sandbox is not enabled. Run the host preflight before launching."
	}
	Start-Process -FilePath $resolvedOutput
}
