# China Distribution and Updates

Palot's mainland China release keeps domestic and global capabilities separate:

- DeepSeek, GLM, Alibaba Model Studio, and Tencent Token Plan use their official APIs and are
  presented as the primary model path that works directly on mainland China networks.
- Codex remains an optional capability. Users must independently meet OpenAI account, billing,
  region, and network requirements. Palot does not provide a proxy, network-circumvention service,
  third-party relay, or resold account.
- Windows updates use a domestic HTTPS mirror first when it is configured. A failed mirror check or
  download automatically retries through the public GitHub release. macOS and Linux continue to use
  GitHub only.

## Repository Configuration

Configure these GitHub Actions variables only after a real public HTTPS download service exists:

| Variable | Purpose |
| --- | --- |
| `PALOT_CN_UPDATE_BASE_URL` | Directory containing `latest.yml`, the installer, and blockmap |
| `PALOT_CN_DOWNLOAD_PAGE_URL` | User-facing manual download page |
| `ALIYUN_OSS_REGION` | OSS region, such as `oss-cn-hangzhou` |
| `ALIYUN_OSS_BUCKET` | Release bucket name |

Configure these secrets with a least-privilege OSS identity that can write only the release prefix:

- `ALIYUN_OSS_ACCESS_KEY_ID`
- `ALIYUN_OSS_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_STS_TOKEN` when temporary STS credentials are used

Both Palot URLs must be HTTPS URLs with public hostnames and no credentials or fragments. The update
base URL cannot point at the domain root because its pathname becomes the OSS object prefix. The two
Palot URLs must be configured together. When they are both empty, the build remains GitHub-only.

The HTTPS hostname can be an OSS custom domain or a CDN domain in front of the bucket. Before a
public mainland China launch, confirm the domain, ICP filing, CDN, HTTPS certificate, cache rules,
and software-service compliance requirements with the selected provider and legal adviser.

## Release Layout

The domestic update directory contains only the Windows distribution files needed by the client:

```text
<prefix>/
  Palot-<version>-win-x64.exe
  Palot-<version>-win-x64.exe.blockmap
  SHA256SUMS.txt
  THIRD-PARTY-NOTICES.md
  THIRD-PARTY-SOURCE-OFFER.txt
  latest.yml
```

The release workflow never deletes old versioned installers or blockmaps. It uploads all immutable
files first and `latest.yml` last. Installers and blockmaps receive long-lived immutable caching;
the manifest, checksums, and notices use no-cache headers. A mirror failure fails the release before
the GitHub Release is created.

## Local Validation

Validate an unconfigured GitHub-only build:

```powershell
bun run validate:china-distribution
```

Validate a configured build without exposing OSS credentials:

```powershell
$env:PALOT_CN_UPDATE_BASE_URL = "https://download.example.cn/palot/windows"
$env:PALOT_CN_DOWNLOAD_PAGE_URL = "https://palot.example.cn/download"
$env:ALIYUN_OSS_REGION = "oss-cn-hangzhou"
$env:ALIYUN_OSS_BUCKET = "palot-release"
bun run validate:china-distribution
```

Build-time values are embedded only in the Electron main process. OSS credentials are used only by
the release upload step and must never enter the application bundle, logs, or release artifacts.

Before enabling the mirror for users, verify `latest.yml`, the versioned installer, and blockmap are
available from the same directory; test China-source download and GitHub fallback from a packaged
Windows build; and repeat the installer signature, update, data-preservation, and sensitive-content
acceptance gates documented in `docs/windows-acceptance.md`.

## Versioned Release Procedure

The Release workflow deliberately does not rebuild the current version when pending Changesets
exist. Run it once after merging a feature PR to create the version PR, merge that PR, and run the
workflow again to tag and publish the new version. Use `rebuild_current_version` only for an explicit
recovery of an existing release. This prevents an unversioned change from overwriting or duplicating
the previous installer name.
