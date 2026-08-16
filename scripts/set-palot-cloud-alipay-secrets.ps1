<#
.SYNOPSIS
	Adds Alipay merchant material to the existing Palot Cloud Secret without printing key contents.
#>

[CmdletBinding()]
param(
	[string]$Namespace,
	[string]$Kubeconfig = (Join-Path $HOME ".sealos\kubeconfig"),
	[string]$SecretName = "palot-cloud-gateway-credentials",
	[string]$Kubectl = "kubectl",
	[string]$AppId,
	[string]$SellerId,
	[string]$PrivateKeyPath,
	[string]$PublicKeyPath
)

$ErrorActionPreference = "Stop"

function ConvertTo-SecretData {
	param([Parameter(Mandatory = $true)][string]$Value, [Parameter(Mandatory = $true)][string]$Name)
	if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name cannot be empty" }
	return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value.Trim()))
}

if (!(Test-Path -LiteralPath $Kubeconfig -PathType Leaf)) {
	throw "Sealos kubeconfig not found: $Kubeconfig"
}
if (!(Get-Command $Kubectl -ErrorAction SilentlyContinue)) {
	throw "kubectl was not found: $Kubectl"
}
if ([string]::IsNullOrWhiteSpace($AppId)) { $AppId = Read-Host "Enter the Alipay application id" }
if ([string]::IsNullOrWhiteSpace($SellerId)) { $SellerId = Read-Host "Enter the Alipay seller id" }
if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
	$PrivateKeyPath = Read-Host "Enter the path to the PKCS#8 merchant private key PEM file"
}
if ([string]::IsNullOrWhiteSpace($PublicKeyPath)) {
	$PublicKeyPath = Read-Host "Enter the path to the Alipay public key PEM file"
}

$privateKey = Get-Content -LiteralPath $PrivateKeyPath -Raw
$publicKey = Get-Content -LiteralPath $PublicKeyPath -Raw

if ([string]::IsNullOrWhiteSpace($Namespace)) {
	$Namespace = & $Kubectl --kubeconfig $Kubeconfig --insecure-skip-tls-verify `
		config view --minify -o "jsonpath={.contexts[0].context.namespace}"
	if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Namespace)) {
		throw "Unable to resolve the Sealos namespace from kubeconfig"
	}
}

$existingJson = & $Kubectl --kubeconfig $Kubeconfig --insecure-skip-tls-verify `
	-n $Namespace get secret $SecretName -o json
if ($LASTEXITCODE -ne 0) { throw "Palot Cloud Secret was not found" }
$manifest = $existingJson | ConvertFrom-Json
if ($null -eq $manifest.data) { $manifest | Add-Member -MemberType NoteProperty -Name data -Value @{} }

$manifest.data | Add-Member -Force -MemberType NoteProperty -Name ALIPAY_APP_ID `
	-Value (ConvertTo-SecretData $AppId "Alipay application id")
$manifest.data | Add-Member -Force -MemberType NoteProperty -Name ALIPAY_SELLER_ID `
	-Value (ConvertTo-SecretData $SellerId "Alipay seller id")
$manifest.data | Add-Member -Force -MemberType NoteProperty -Name ALIPAY_PRIVATE_KEY `
	-Value (ConvertTo-SecretData $privateKey "Alipay private key")
$manifest.data | Add-Member -Force -MemberType NoteProperty -Name ALIPAY_PUBLIC_KEY `
	-Value (ConvertTo-SecretData $publicKey "Alipay public key")

$manifest.metadata.PSObject.Properties.Remove("managedFields")
$manifest.metadata.PSObject.Properties.Remove("resourceVersion")
$manifest.metadata.PSObject.Properties.Remove("uid")
$manifest.metadata.PSObject.Properties.Remove("creationTimestamp")

$manifest | ConvertTo-Json -Depth 10 -Compress | & $Kubectl --kubeconfig $Kubeconfig `
	--insecure-skip-tls-verify -n $Namespace apply -f -
if ($LASTEXITCODE -ne 0) { throw "kubectl could not update the Palot Cloud Secret" }

Write-Host "Alipay merchant credentials are configured in namespace $Namespace."
Write-Host "Keep PALOT_PAYMENT_MODE disabled until sandbox acceptance has passed."
