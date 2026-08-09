<#
.SYNOPSIS
	Verifies that the Sealos Secret helper uses stdin and preserves the token pepper.
#>

$ErrorActionPreference = "Stop"
$global:promptCount = 0
$global:kubectlCalls = @()
$global:manifestPayload = ""

function global:Read-Host {
	param([string]$Prompt, [switch]$AsSecureString)

	$global:promptCount += 1
	return ConvertTo-SecureString -String ("test-provider-key-" + $global:promptCount) `
		-AsPlainText -Force
}

function global:Mock-Kubectl {
	$arguments = @($args)
	$global:kubectlCalls += ,$arguments
	$joined = $arguments -join " "
	if ($joined -like "*get secret*") {
		$global:LASTEXITCODE = 0
		return '{"data":{"PALOT_TOKEN_PEPPER":"cHJlc2VydmVkLXBlcHBlcg=="}}'
	}
	if ($joined -like "*apply -f -*") {
		$global:manifestPayload = ($input | Out-String).Trim()
		$global:LASTEXITCODE = 0
		return "secret/palot-cloud-gateway-credentials configured"
	}
	$global:LASTEXITCODE = 0
}

$scriptPath = Join-Path $PSScriptRoot "..\set-palot-cloud-sealos-secrets.ps1"
$kubeconfig = Join-Path $HOME ".sealos\kubeconfig"
. $scriptPath -Namespace "ns-test" -Kubeconfig $kubeconfig -Kubectl "Mock-Kubectl"

$manifest = $global:manifestPayload | ConvertFrom-Json
if ($manifest.metadata.namespace -ne "ns-test") {
	throw "Namespace was not applied"
}
if ($manifest.data.PALOT_TOKEN_PEPPER -ne "cHJlc2VydmVkLXBlcHBlcg==") {
	throw "Existing token pepper was not preserved"
}
$deepSeekKey = [Text.Encoding]::UTF8.GetString(
	[Convert]::FromBase64String($manifest.data.DEEPSEEK_API_KEY)
)
$zhipuKey = [Text.Encoding]::UTF8.GetString(
	[Convert]::FromBase64String($manifest.data.ZHIPUAI_API_KEY)
)
if ($deepSeekKey -ne "test-provider-key-1" -or $zhipuKey -ne "test-provider-key-2") {
	throw "Provider credentials were encoded incorrectly"
}
$argumentText = $global:kubectlCalls | ForEach-Object { $_ -join " " }
if ($argumentText -match "test-provider-key") {
	throw "A provider credential leaked into kubectl arguments"
}

Write-Host "Palot Cloud Sealos Secret helper test passed."
