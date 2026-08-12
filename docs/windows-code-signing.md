# Windows Code Signing

Buying a trusted code-signing certificate does not require reinstalling Windows. A provider
may require a signing client, hardware-token driver, or a restart. Palot itself must be rebuilt
and signed; an existing unsigned installer cannot be signed retroactively.

## Selection Matrix

| Choice | Identity | CI automation | Key handling | Palot default |
| --- | --- | --- | --- | --- |
| Cloud signing | Individual or organization, subject to provider eligibility | Best when the provider offers an official GitHub Action or CLI | Non-exportable key held by the provider | Preferred |
| Exportable PFX | Provider-dependent | Supported by electron-builder through repository secrets | Base64 PFX or secure URL plus password | Supported |
| Hardware token | Usually organization or verified individual | Often needs a self-hosted runner and vendor middleware | Non-exportable key on the token | Fallback only |

Before purchasing, record the applicant type, supported countries, verification documents,
renewal term, timestamp service, GitHub Actions support, and total recurring cost. Do not buy a
certificate until the applicant identity is confirmed.

## Current Procurement Decision - 2026-08-12

The primary candidate for an individual developer in mainland China is SSL.com IV Code Signing with
eSigner cloud signing. Do not purchase it until SSL.com support confirms in writing that a mainland
China government-issued identity document and telephone number are eligible for IV validation.

- SSL.com IV Code Signing is advertised for individual developers without a registered company. The
  one-year certificate price is USD 129 and standard validation requires a government-issued ID.
- eSigner Tier 1 is USD 180 per year for 240 signings and one credential. The expected first-year
  total is therefore USD 309 before tax, currency conversion, or payment fees.
- SSL.com documents GitHub Actions integration using four secrets: account username, account
  password, credential ID, and TOTP secret. Palot must never store these values in source, logs, or
  artifacts.
- The published `SSLcom/actions-codesigner` example currently uses a moving `develop` branch and has
  no stable release tag. Any Palot integration must pin a reviewed commit SHA and must not use
  `@develop` or another mutable branch.
- Microsoft Artifact Signing Basic costs USD 9.99 per month for 5,000 signatures and supports
  managed certificates, CI integrations, and external timestamping. However, Microsoft currently
  limits Public Trust organization validation to a published country list that does not include
  mainland China, while individual validation is limited to the United States and Canada. Private
  Trust does not make a public Windows installer trusted, so this option is not suitable for Palot's
  current applicant.

Before payment, ask SSL.com support to confirm all of the following in one written response:

1. Mainland China individual validation is supported for the applicant's exact ID type.
2. eSigner Tier 1 can sign Windows `.exe` files from GitHub-hosted Windows runners without a hardware
   token or interactive approval.
3. Authenticode RFC 3161 timestamping is included and remains valid after certificate expiry.
4. The displayed publisher subject will be the applicant's verified legal name and can be supplied
   exactly as the `WINDOWS_SIGNING_PUBLISHER` repository variable.
5. Renewal, refund, failed-validation, tax, and currency-conversion terms are confirmed before
   checkout.

Official pages reviewed for this decision:

- [SSL.com IV Code Signing](https://www.ssl.com/products/software-integrity/code-signing/iv/)
- [SSL.com eSigner pricing](https://www.ssl.com/products/software-integrity/signing-service/)
- [SSL.com GitHub Actions integration](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/)
- [Microsoft Artifact Signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart#prerequisites)
- [Microsoft Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)

## Release Configuration

The current workflow supports an electron-builder-compatible PFX through:

- `WINDOWS_CSC_LINK`: a secure certificate URL or Base64-encoded PFX
- `WINDOWS_CSC_KEY_PASSWORD`: the PFX password, when required

Set the `WINDOWS_SIGNING_PUBLISHER` repository variable to the certificate's complete subject name
exactly as Windows reports it, for example `CN=Example Company, O=Example Company, C=CN`. This value
is not secret. Stable release validation rejects a different publisher instead of accepting any
otherwise valid Authenticode certificate.

If the selected provider keeps the key in a cloud service, replace the PFX environment variables
with the provider's official signing step. Do not export or commit a private key to the repository.

Alpha and Beta previews may be unsigned. RC and stable Windows versions fail before packaging when
no signing configuration is present, and the installer smoke test verifies the installer, installed
application, and uninstaller signatures again after packaging. RC and stable artifacts must use the
configured publisher and contain a trusted timestamp. The workflow also verifies that `latest.yml`
names the exact installer and matches its version, size, and SHA-512 before uploading either file.

## Acceptance

For the first signed release:

1. Verify the installer signature is valid, timestamped, and shows the expected publisher.
2. Upgrade the public unsigned `v0.11.0` installer in place and preserve XDG and Electron data.
3. Verify update download and installation through the GitHub Release update manifest.
4. Repeat installation as a standard user on clean Windows 10 and Windows 11 systems.

Run the signed Hyper-V gate with the same complete certificate subject configured in GitHub:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-windows-vm-acceptance.ps1 `
  -InstallerPath apps/desktop/release/Palot-0.12.0-rc.1-win-x64.exe `
  -PreviousInstallerPath apps/desktop/release/Palot-0.12.0-beta.2-win-x64.exe `
  -ExpectedPublisher "CN=Example Company, O=Example Company, C=CN" `
  -RequireTimestamp
```

Use the same `-ExpectedPublisher` and `-RequireTimestamp` arguments when generating the Windows
Sandbox configuration. Never use `-AllowUnsigned` for an RC or stable acceptance run.

A valid signature replaces "Unknown publisher" with the verified publisher. Microsoft SmartScreen
may still warn until a new certificate has accumulated reputation, so signing does not guarantee
that every reputation warning disappears immediately.
