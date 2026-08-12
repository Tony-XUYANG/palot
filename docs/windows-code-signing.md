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
