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

## Current Procurement Decision - 2026-08-24

The primary candidate for an individual developer in mainland China is SSL.com IV Code Signing with
eSigner cloud signing. SSL.com's official accepted-country list includes China (`CN`), and the IV
product does not require a registered business. Do not purchase it until SSL.com confirms in writing
that the applicant's exact mainland China identity document and `+86` telephone number can complete
IV validation and callback.

- SSL.com IV Code Signing is advertised for individual developers without a registered company. The
  one-year certificate price is USD 129 and standard validation requires a government-issued ID.
- eSigner Tier 1 is USD 180 per year for 240 signings and one credential. SSL.com advertises a
  30-day eSigner trial for new certificates. The expected recurring first-year components total
  USD 309 before tax, currency conversion, or payment fees; confirm the checkout total before paying.
- Palot uses the official Windows eSigner CKA integration rather than the old Docker-based
  `SSLcom/actions-codesigner@develop` example. The Action has no stable tag and its mutable branch is
  not acceptable for a release trust boundary.
- The workflow pins eSigner CKA `1.0.6` from SSL.com's GitHub release. The ZIP must be exactly
  15,303,440 bytes with SHA-256
  `e4971440e4ebed94328492cf36e18999554c5c657c856f1cb14a6072c8b1c263`, and the contained installer
  must have a valid SSL Corp Authenticode signature before it runs.
- eSigner credentials configure CKA on an ephemeral GitHub-hosted Windows runner. The workflow does
  not print command output from credential-bearing operations and unloads the certificate, master
  key, and local CKA state after packaging.
- Microsoft Artifact Signing Basic costs USD 9.99 per month for 5,000 signatures and supports
  managed certificates, CI integrations, and external timestamping. However, Microsoft currently
  limits Public Trust organization validation to a published country list that does not include
  mainland China, while individual validation is limited to the United States and Canada. Private
  Trust does not make a public Windows installer trusted, so this option is not suitable for Palot's
  current applicant.

Email `sales@ssl.com` and copy `validation@ssl.com` with the subject
`Mainland China IV Code Signing and eSigner CI eligibility`. Ask SSL.com to confirm all of the
following in one written response:

1. Mainland China individual validation is supported for the applicant's exact ID type.
2. eSigner Tier 1 and eSigner CKA can sign Windows `.exe` files from GitHub-hosted Windows runners
   without a hardware token or interactive approval for every file.
3. Authenticode RFC 3161 timestamping is included and remains valid after certificate expiry.
4. The displayed publisher subject will be the applicant's verified legal name and can be supplied
   exactly as the `WINDOWS_SIGNING_PUBLISHER` repository variable.
5. Renewal, refund, failed-validation, tax, and currency-conversion terms are confirmed before
   checkout.

Do not send an ID image by email or support chat. SSL.com explicitly requires identity documents to
be uploaded only through the authenticated validation document flow.

SignPath Foundation is not the default commercial release route. Its free OSS certificate displays
`SignPath Foundation` rather than the Palot maintainer, requires an already reputable project,
requires every release to be manually approved, and requires a public signing and privacy policy.
Palot can reconsider it for an OSS-only preview after building a public user base, but it does not
provide the desired long-term commercial publisher identity.

Official pages reviewed for this decision:

- [SSL.com IV Code Signing](https://www.ssl.com/products/software-integrity/code-signing/iv/)
- [SSL.com eSigner pricing](https://www.ssl.com/products/software-integrity/signing-service/)
- [SSL.com GitHub Actions integration](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/)
- [SSL.com eSigner CKA CI integration](https://www.ssl.com/how-to/how-to-integrate-esigner-cka-with-ci-cd-tools-for-automated-code-signing/)
- [SSL.com accepted countries](https://www.ssl.com/country_codes/)
- [Microsoft Artifact Signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart#prerequisites)
- [Microsoft Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)

## Release Configuration

Set `WINDOWS_SIGNING_MODE` to exactly one of these repository variable values:

- `sslcom-esigner`: preferred cloud signing through SSL.com eSigner CKA
- `pfx`: compatibility path for an exportable certificate

Leave the variable empty only for unsigned Alpha or Beta previews. RC and stable builds reject an
empty or unknown mode. Set `WINDOWS_SIGNING_PUBLISHER` to the certificate's complete subject name
exactly as Windows reports it, for example `CN=Example Publisher, C=CN`. Optionally set
`WINDOWS_SIGNING_CERT_SHA1` to the expected 40-character certificate thumbprint so CKA cannot select
another otherwise matching certificate.

For `sslcom-esigner`, configure these GitHub repository secrets after certificate enrollment:

- `SSL_COM_USERNAME`
- `SSL_COM_PASSWORD`
- `SSL_COM_TOTP_SECRET`

Do not configure a moving GitHub Action reference or upload the CKA master key. The workflow fetches
the pinned public CKA installer, loads the cloud certificate into the ephemeral runner's current-user
certificate store, and lets electron-builder sign the application executable, NSIS uninstaller, and
final installer through `signtool.exe`. SHA-256 and SSL.com's RFC 3161 timestamp service are used for
each signature.

For `pfx`, configure:

- `WINDOWS_CSC_LINK`: a secure certificate URL or Base64-encoded PFX
- `WINDOWS_CSC_KEY_PASSWORD`: the PFX password, when required

The publisher and certificate thumbprint are not secrets. Passwords, TOTP seeds, certificate files,
and private keys are secrets and must never enter repository variables, source, logs, caches, or
release artifacts.

Alpha and Beta previews may be unsigned only when `WINDOWS_SIGNING_MODE` is empty. Once a signing
mode is configured, all preview, RC, and stable builds must pass the publisher and timestamp checks;
an accidentally unsigned Beta cannot be accepted. The installer smoke test verifies the installer,
installed application, and uninstaller after packaging. The workflow also verifies that `latest.yml`
names the exact installer and matches its version, size, and SHA-512 before uploading either file.
All releases are initially prereleases so public update assets can be tested. Only an unqualified
stable version is promoted to GitHub Latest after the public Windows automatic-update test succeeds.

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
