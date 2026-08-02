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

If the selected provider keeps the key in a cloud service, replace the PFX environment variables
with the provider's official signing step. Do not export or commit a private key to the repository.

Prerelease versions containing a SemVer suffix may be unsigned. Stable Windows versions fail
before packaging when no signing configuration is present, and the installer smoke test verifies
the final Authenticode signature again after packaging.

## Acceptance

For the first signed release:

1. Verify the installer signature is valid, timestamped, and shows the expected publisher.
2. Upgrade the public unsigned `v0.11.0` installer in place and preserve XDG and Electron data.
3. Verify update download and installation through the GitHub Release update manifest.
4. Repeat installation as a standard user on clean Windows 10 and Windows 11 systems.

A valid signature replaces "Unknown publisher" with the verified publisher. Microsoft SmartScreen
may still warn until a new certificate has accumulated reputation, so signing does not guarantee
that every reputation warning disappears immediately.
