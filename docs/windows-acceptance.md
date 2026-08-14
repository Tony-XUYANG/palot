# Windows Release Acceptance

Palot uses free Microsoft test environments for release validation. Do not purchase a Windows
license for this workflow. Windows feature changes and restarts always require a separate, explicit
user decision.

## 1. Host Preflight

Run the read-only report first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-validation-host.ps1
```

The report is written under `.local/windows-acceptance/`. To request Hyper-V and Windows Sandbox
enablement, rerun with `-EnableFeatures`. The script will still stop unless the operator enters an
exact lowercase `y`. It uses `-NoRestart` and never restarts Windows.

When a D drive is available, the preflight uses `D:\Palot\VirtualMachines` as the VM storage target
and applies the 90 GB free-space gate to D rather than the Windows system drive. Override this with
`-VMRoot` when another dedicated drive is preferred.

## 2. Windows Sandbox

Generate a `.wsb` file for an unsigned prerelease installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/new-windows-sandbox-config.ps1 `
  -InstallerPath apps/desktop/release/Palot-0.12.0-beta.0-win-x64.exe -AllowUnsigned
```

Open the generated `.wsb` after Sandbox is enabled. The test scripts and installer directory are
mounted read-only; only `.local/windows-acceptance/sandbox/` is writable. The bootstrap runs the existing
installer smoke test with an empty `PATH` and records a sanitized JSON report containing OS,
installer hash, signature state, and pass/fail status. It does not include environment variables,
credentials, kubeconfig, application data, or model configuration.

Windows Sandbox is disposable and is the Windows 10 clean-install gate. Use the Hyper-V VM for
persistent upgrade and rollback checks.

## 3. Hyper-V Windows 11 VM

Download a Windows 11 Enterprise evaluation ISO from the
[Microsoft Evaluation Center](https://www.microsoft.com/zh-cn/evalcenter/evaluate-windows-11-enterprise)
or installation media from the [official Windows 11 download page](https://www.microsoft.com/zh-cn/software-download/windows11).

Preview the configuration without changing Hyper-V:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/new-palot-hyperv-vm.ps1 `
  -IsoPath C:\InstallMedia\Windows11.iso
```

Pass `-Create` only when ready. The script again requires lowercase `y` and creates a Generation 2
VM with 4 vCPU, dynamic 4-8 GB memory, an 80 GB VHDX, Default Switch networking, and Secure Boot.
It defaults to `D:\Palot\VirtualMachines` when D exists and refuses creation if that target drive has
less than 90 GB free. The 80 GB VHDX is dynamically expanding, so monitor the host drive and keep at
least 20 GB free during acceptance. Remove the ISO after Windows setup to recover its space. C remains
the fallback only on computers without a D drive.
After Windows setup and updates, shut the VM down and run with `-CreateCleanCheckpoint` to create
the `Clean Windows - before Palot` checkpoint.

After the first local administrator reaches the desktop, reconnect the VM to the Default Switch and
run `scripts/initialize-palot-windows-vm.ps1`, passing the exact local administrator name with
`-AdminUserName`. Enter the VM credential only in the Windows credential dialog. The script creates a
non-administrator `Palot测试用户` account with the same VM-only password, uses the built-in Windows
Update API, and writes a sanitized report under `.local/windows-acceptance/`.

After creating the clean checkpoint, run the persistent installer gate with the standard-user
credential:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-windows-vm-acceptance.ps1 `
  -InstallerPath apps/desktop/release/Palot-0.12.0-beta.0-win-x64.exe `
  -PreviousInstallerPath apps/desktop/release/Palot-0.11.0-win-x64.exe `
  -AllowUnsigned
```

The runner copies both installers and the smoke script into the guest, rejects an administrator
credential, verifies Git, OpenCode, and Docker are absent from the clean system `PATH`, and executes
the install, upgrade, bundled-runtime, launch, uninstall, and data-preservation checks from a path
with spaces. Its sanitized report is written under `.local/windows-acceptance/`.

## 4. Release Matrix

Record each result without secrets:

| Gate | Windows Sandbox | Hyper-V Windows 11 |
| --- | --- | --- |
| No system Git/OpenCode/Docker and empty PATH | Required | Required |
| Bundled runtime launch | Required | Required |
| Standard user, Chinese username, path with spaces | Required | Required |
| `v0.11.0` to current upgrade | Optional | Required |
| Uninstall preserves XDG and Electron data | Required | Required |
| Authenticode publisher and timestamp | RC/stable | RC/stable |
| Automatic update and rollback | Not persistent | Required |

DeepSeek and GLM must each complete a real edit, Review Diff, automated checks, remote GitHub
Actions build, Sealos HTTPS deployment, `/health`, random 404, readiness, converged logs, and a
60-second stability check before `v0.12.0` is stable. Official Codex CLI remains outside this gate.

## 5. Verified `v0.12.0-beta.1` Baseline

The following prerelease evidence was collected from the source state following commit `01bffed`
and the accepted Palot Cloud gateway image. Reports and runtime logs remain under ignored `.local/`
and `.sealos/` directories; only this sanitized summary is published.

- Public installer: `Palot-0.12.0-beta.1-win-x64.exe`, 250,558,322 bytes, SHA-256
  `fa6c0d20e8f0f57bc646f4a4ae16c04a56d47483a381ac3cd47474abf3e82ffb`. The GitHub asset
  digest, `SHA256SUMS.txt`, and a fresh download produced the same value.
- Signature: `NotSigned`. This is allowed only for the Beta and remains a hard blocker for the stable
  release.
- Windows 11 Pro x64 build 26200: passed as a non-administrator user from an installation path with
  spaces, with no system Git, OpenCode, or Docker available on `PATH`.
- Upgrade: the public `v0.12.0-beta.0` installer, verified as SHA-256
  `90243ef434ca8ae1ea79e39af75dab824675d3c5e9a40a05e5f1348bc865e597`, upgraded to
  a local `v0.12.0-beta.1` candidate from the release commit, SHA-256
  `cbfda8fcaaabad689d2cff9b2d7bc689311adc7d29f389ce20fa70757c065525`, while preserving isolated
  XDG and Electron user data. The GitHub Windows release job independently tested its uploaded
  artifact from the `v0.11.0` baseline. Silent uninstall removed the application and preserved the
  same user data.
- Bundled runtime: OpenCode `1.18.5`, MinGit `2.55.0.windows.3`, GitHub CLI `2.96.0`, and kubectl
  `1.36.1` all launched while `PATH` was empty. The installed application remained running for the
  15-second launch smoke.
- Agent workflows: DeepSeek and GLM each completed a real code edit. The working-tree Review Diff
  reported both changed files and the isolated Node.js project passed all 8 tests.
- Palot Cloud: the public HTTPS gateway returned 200 for `/live` and `/health`, 401 for an
  unauthorized `/v1/models` request, and 404 for a random missing route. The Launchpad port matched
  8080 and the final 62-second comparison reported one Ready Pod, zero restarts, zero replacements,
  zero readiness changes, zero active Warning Events, and no log findings.
- Package scan: no model key, OAuth code, database connection string, kubeconfig, `palot.db`, or
  local Agent smoke data was present in either the local candidate or the downloaded public
  application. The public package contained exactly one accepted Palot Cloud gateway URL.

This baseline qualifies the package for unsigned Beta testing. A trusted Authenticode signature,
timestamp, signed upgrade test, and automatic-update test are still required before `v0.12.0` can be
published as stable.

## 6. Refreshed Domestic Deployment Acceptance - 2026-08-12

The domestic-provider and Docker-free deployment path was repeated against the current development
state. Local evidence remains under ignored `.local/` and `.sealos/` directories.

- DeepSeek `deepseek-chat` added `GET /api/ready` and a focused test in 34 seconds. Commit `2e68e8f`
  passed 8/8 tests.
- GLM `glm-4.7-flash` added consistent JSON 405 handling and `Allow: GET` tests in 120 seconds.
  Commit `3388e22` passed 10/10 tests.
- OpenCode returned an empty Session Diff for both runs, and the existing working-tree Review Diff
  fallback exposed the complete focused changes. Sensitive-diff scans found no credentials.
- GitHub Actions run `31572138646` built the public acceptance project without local Docker and
  produced immutable image
  `ghcr.io/tony-xuyang/palot-acceptance-web@sha256:635b209603450b21c878591d7f14cedd38e4ccbfda71ff5ad218f38221b13bd5`
  from commit `3388e22f644d5f930bfcb42ddc59270570e7ed88`.
- Sealos updated the existing `palot-acceptance-nqykmwuy` deployment in the Hangzhou region and
  workspace `ns-fmb1gbvg`. The retained public URL is
  `https://palot-acceptance-kqmzszvo.sealoshzh.site`.
- Launchpad reported a matching public HTTP network on port 3000. `/`, `/health`, `/api/ready`, and
  `/api/info` returned 200; `POST /health` returned JSON 405 with `Allow: GET`; a random missing path
  returned JSON 404.
- The final runtime comparison covered 226 seconds and reported one Ready Pod, zero restarts, zero
  replacements, zero readiness changes, zero active Warning Events, and no log findings.
- The current OpenAI Codex compatibility request reached the official API but its configured key was
  rejected as incorrect. Codex remains available but is not marked as accepted by this run and does
  not block the domestic `v0.12` release gate.

## 7. Verified Public `v0.12.0-beta.2` Baseline

The public prerelease was built from commit `404c9c0`. The release and its complete cross-platform
artifacts are available from [GitHub Release `v0.12.0-beta.2`](https://github.com/Tony-XUYANG/palot/releases/tag/v0.12.0-beta.2).
The [release workflow run](https://github.com/Tony-XUYANG/palot/actions/runs/31577172618) and the
[source CI run](https://github.com/Tony-XUYANG/palot/actions/runs/31577012901) both completed
successfully.

- Public Windows installer: `Palot-0.12.0-beta.2-win-x64.exe`, 250,560,314 bytes, SHA-256
  `85ee8a0962c282bafbfd597a28f5f54926f756a8800ed3ee15d2bb72ddcd9564`. The GitHub asset digest,
  `SHA256SUMS.txt`, and a fresh download produced the same value.
- Signature: `NotSigned`. The package remains an unsigned prerelease and must not be promoted as a
  stable release.
- The local installer gate upgraded `v0.12.0-beta.1` to a `v0.12.0-beta.2` candidate, launched all
  four bundled runtimes with an empty `PATH`, kept Palot running for 15 seconds, and preserved user
  data after uninstall. The GitHub Windows job independently upgraded the `v0.11.0` baseline to the
  public artifact.
- A persistent Windows 11 Pro x64 build 26200 VM passed as the non-administrator Chinese user
  `Palot测试用户`, using an installation path with spaces and no system Git, OpenCode, or Docker. It
  upgraded `v0.12.0-beta.1` to `v0.12.0-beta.2`, launched OpenCode `1.18.5`, MinGit
  `2.55.0.windows.3`, GitHub CLI `2.96.0`, and kubectl `1.36.1`, and preserved user data after
  uninstall.
- The downloaded public installer was independently unpacked and its `app.asar` extracted. A scan of
  367 application text and metadata files found zero OpenAI keys, OAuth callback codes, GitHub
  tokens, bearer tokens, private keys, JWTs, kubeconfig secrets, or credential-bearing database
  URLs. A single broad `sk-` match was classified as a `verilog-sk-prompt-*` syntax-highlighting
  symbol, not a credential.
- The complete unpacked installer contained no `auth.json`, kubeconfig, `palot.db`, `.env`, Agent
  smoke directory, Windows acceptance directory, or local `.sealos` state.

The automatic-update defect found during follow-up testing was fixed in commit `e380311`: Windows
now calls `quitAndInstall(true, true)`, so NSIS runs silently instead of opening an interactive
wizard. An isolated real update then downloaded the public `v0.12.0-beta.2` payload, updated a
locally built fixed `v0.12.0-beta.1` baseline to `v0.12.0-beta.2`, preserved XDG and Electron data,
and preserved the same data after uninstall. The reusable acceptance tooling and regression tests
were committed in `b74033a`; [CI run 31688767817](https://github.com/Tony-XUYANG/palot/actions/runs/31688767817)
passed.

The public `v0.12.0-beta.2` binary predates the silent-install fix, so it cannot bootstrap a fully
automatic update to the RC. `v0.12.0-beta.3` is the first public updater baseline containing the
fix. The release workflow must verify the public `beta.3 -> rc.1` path, including publisher,
timestamp, data preservation, and uninstall behavior. `WINDOWS_AUTO_UPDATE_BASE_SHA256` now pins the
SHA-256 recorded in the public `beta.3` release.

This evidence keeps `v0.12.0-beta.2` suitable for public Beta testing. Trusted Authenticode signing,
a timestamp, signed upgrade coverage, and a public `beta.3 -> rc.1` automatic-update pass remain
mandatory before the stable `v0.12.0` release.

## 8. Public `v0.12.0-beta.3` Update Baseline

The [public prerelease](https://github.com/Tony-XUYANG/palot/releases/tag/v0.12.0-beta.3) was built
from commit `fd15327`. [Release workflow 31770496413](https://github.com/Tony-XUYANG/palot/actions/runs/31770496413)
completed successfully across Windows x64, macOS arm64/x64, and Linux x64.

- Windows installer: `Palot-0.12.0-beta.3-win-x64.exe`, 250,560,064 bytes, SHA-256
  `d5915efff4fa290bc7af176e1075acd2237a2bd6c7e8d0fee1a5c73e603987f4`.
- The Windows job passed runtime preparation, manifest integrity, unsigned Beta signature policy,
  upgrade installation, empty-PATH bundled runtime checks, launch, uninstall data preservation, and
  the new unpacked-package sensitive-information scan before uploading the artifact.
- The release is intentionally marked prerelease and the post-release automatic-update job is
  intentionally skipped because `beta.3` is the bootstrap source rather than an update target.
- `WINDOWS_AUTO_UPDATE_BASE_SHA256` now pins the public installer digest. RC and stable workflows
  must use this exact baseline and fail if the asset changes.

The next required update evidence is a signed, timestamped public `beta.3 -> rc.1` pass. No RC or
stable version may be promoted to Latest until that check succeeds.
