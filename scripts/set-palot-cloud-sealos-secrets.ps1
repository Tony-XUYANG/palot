<#
.SYNOPSIS
	Creates or updates the Palot Cloud provider Secret without exposing credentials in arguments.
#>

[CmdletBinding()]
param(
	[string]$Namespace,
	[string]$Kubeconfig = (Join-Path $HOME ".sealos\kubeconfig"),
	[string]$SecretName = "palot-cloud-gateway-credentials",
	[string]$Kubectl = "kubectl",
	[switch]$UseGui
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

function Read-ProviderCredentials {
	if (!$UseGui) {
		return @{
			DeepSeek = Read-Host "Enter the official DeepSeek API key" -AsSecureString
			Zhipu = Read-Host "Enter the official Zhipu AI API key" -AsSecureString
		}
	}

	Add-Type -AssemblyName System.Windows.Forms
	Add-Type -AssemblyName System.Drawing
	$form = New-Object Windows.Forms.Form
	$form.Text = "Palot Cloud Sealos credentials"
	$form.ClientSize = New-Object Drawing.Size(520, 210)
	$form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
	$form.MaximizeBox = $false
	$form.MinimizeBox = $false
	$form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
	$form.TopMost = $true

	$intro = New-Object Windows.Forms.Label
	$intro.Location = New-Object Drawing.Point(20, 15)
	$intro.Size = New-Object Drawing.Size(480, 34)
	$intro.Text = "Paste the two official provider keys. Values stay hidden and are sent only to Sealos."
	$form.Controls.Add($intro)

	$deepSeekLabel = New-Object Windows.Forms.Label
	$deepSeekLabel.Location = New-Object Drawing.Point(20, 60)
	$deepSeekLabel.Size = New-Object Drawing.Size(110, 24)
	$deepSeekLabel.Text = "DeepSeek Key"
	$form.Controls.Add($deepSeekLabel)

	$deepSeekBox = New-Object Windows.Forms.TextBox
	$deepSeekBox.Location = New-Object Drawing.Point(135, 57)
	$deepSeekBox.Size = New-Object Drawing.Size(365, 24)
	$deepSeekBox.UseSystemPasswordChar = $true
	$form.Controls.Add($deepSeekBox)

	$zhipuLabel = New-Object Windows.Forms.Label
	$zhipuLabel.Location = New-Object Drawing.Point(20, 100)
	$zhipuLabel.Size = New-Object Drawing.Size(110, 24)
	$zhipuLabel.Text = "GLM Key"
	$form.Controls.Add($zhipuLabel)

	$zhipuBox = New-Object Windows.Forms.TextBox
	$zhipuBox.Location = New-Object Drawing.Point(135, 97)
	$zhipuBox.Size = New-Object Drawing.Size(365, 24)
	$zhipuBox.UseSystemPasswordChar = $true
	$form.Controls.Add($zhipuBox)

	$saveButton = New-Object Windows.Forms.Button
	$saveButton.Location = New-Object Drawing.Point(330, 155)
	$saveButton.Size = New-Object Drawing.Size(80, 30)
	$saveButton.Text = "Save"
	$saveButton.DialogResult = [Windows.Forms.DialogResult]::OK
	$form.AcceptButton = $saveButton
	$form.Controls.Add($saveButton)

	$cancelButton = New-Object Windows.Forms.Button
	$cancelButton.Location = New-Object Drawing.Point(420, 155)
	$cancelButton.Size = New-Object Drawing.Size(80, 30)
	$cancelButton.Text = "Cancel"
	$cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
	$form.CancelButton = $cancelButton
	$form.Controls.Add($cancelButton)

	$form.Add_Shown({ $deepSeekBox.Focus() })
	if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
		throw "Credential setup was cancelled"
	}
	try {
		return @{
			DeepSeek = ConvertTo-SecureString -String $deepSeekBox.Text -AsPlainText -Force
			Zhipu = ConvertTo-SecureString -String $zhipuBox.Text -AsPlainText -Force
		}
	}
	finally {
		$deepSeekBox.Clear()
		$zhipuBox.Clear()
		$form.Dispose()
	}
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

$credentials = Read-ProviderCredentials

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
		DEEPSEEK_API_KEY = ConvertTo-KubernetesSecretData $credentials.DeepSeek "DeepSeek API key"
		ZHIPUAI_API_KEY = ConvertTo-KubernetesSecretData $credentials.Zhipu "Zhipu AI API key"
	}
}

$manifest | ConvertTo-Json -Depth 8 -Compress | & $Kubectl --kubeconfig $Kubeconfig `
	--insecure-skip-tls-verify -n $Namespace apply -f -
if ($LASTEXITCODE -ne 0) {
	throw "kubectl could not apply the Palot Cloud credential Secret"
}

Write-Host "Palot Cloud credentials are configured in namespace $Namespace."
