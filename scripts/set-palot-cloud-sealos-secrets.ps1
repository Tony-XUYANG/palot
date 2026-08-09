<#
.SYNOPSIS
	Creates or updates the Palot Cloud provider Secret without exposing credentials in arguments.
#>

[CmdletBinding()]
param(
	[string]$Namespace,
	[string]$Kubeconfig = (Join-Path $HOME ".sealos\kubeconfig"),
	[string]$SecretName = "palot-cloud-gateway-credentials",
	[string]$Kubectl = "kubectl"
)

$ErrorActionPreference = "Stop"

function ConvertTo-KubernetesSecretData {
	param(
		[Parameter(Mandatory = $true)]
		[Security.SecureString]$Value,
		[Parameter(Mandatory = $true)]
		[string]$Name
	)

	$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
	try {
		$plainText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
		if ([string]::IsNullOrWhiteSpace($plainText)) {
			throw "$Name cannot be empty"
		}
		return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plainText))
	}
	finally {
		[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
	}
}

function New-TokenPepperData {
	$bytes = New-Object byte[] 48
	$random = [Security.Cryptography.RandomNumberGenerator]::Create()
	try {
		$random.GetBytes($bytes)
	}
	finally {
		$random.Dispose()
	}
	$pepper = [Convert]::ToBase64String($bytes)
	return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pepper))
}

if (!(Test-Path -LiteralPath $Kubeconfig -PathType Leaf)) {
	throw "Sealos kubeconfig not found: $Kubeconfig"
}
if (!(Get-Command $Kubectl -ErrorAction SilentlyContinue)) {
	throw "kubectl was not found: $Kubectl"
}
if ($SecretName -notmatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$") {
	throw "SecretName must be a valid lowercase Kubernetes name"
}

if ([string]::IsNullOrWhiteSpace($Namespace)) {
	$Namespace = & $Kubectl --kubeconfig $Kubeconfig --insecure-skip-tls-verify `
		config view --minify -o "jsonpath={.contexts[0].context.namespace}"
	if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Namespace)) {
		throw "Unable to resolve the Sealos namespace from kubeconfig"
	}
}

$existingJson = & $Kubectl --kubeconfig $Kubeconfig --insecure-skip-tls-verify `
	-n $Namespace get secret $SecretName -o json 2>$null
$existingExitCode = $LASTEXITCODE
$pepperData = $null
if ($existingExitCode -eq 0) {
	$existing = $existingJson | ConvertFrom-Json
	$pepperData = $existing.data.PALOT_TOKEN_PEPPER
}
if ([string]::IsNullOrWhiteSpace($pepperData)) {
	$pepperData = New-TokenPepperData
}

$deepSeekKey = Read-Host "Enter the official DeepSeek API key" -AsSecureString
$zhipuKey = Read-Host "Enter the official Zhipu AI API key" -AsSecureString

$manifest = @{
	apiVersion = "v1"
	kind = "Secret"
	metadata = @{
		name = $SecretName
		namespace = $Namespace
		labels = @{
			"app.kubernetes.io/part-of" = "palot-cloud"
			"app.kubernetes.io/managed-by" = "palot-secret-tool"
		}
	}
	type = "Opaque"
	data = @{
		PALOT_TOKEN_PEPPER = $pepperData
		DEEPSEEK_API_KEY = ConvertTo-KubernetesSecretData $deepSeekKey "DeepSeek API key"
		ZHIPUAI_API_KEY = ConvertTo-KubernetesSecretData $zhipuKey "Zhipu AI API key"
	}
}

$manifest | ConvertTo-Json -Depth 8 -Compress | & $Kubectl --kubeconfig $Kubeconfig `
	--insecure-skip-tls-verify -n $Namespace apply -f -
if ($LASTEXITCODE -ne 0) {
	throw "kubectl could not apply the Palot Cloud credential Secret"
}

Write-Host "Palot Cloud credentials are configured in namespace $Namespace."
