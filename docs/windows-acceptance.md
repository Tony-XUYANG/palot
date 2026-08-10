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

- Installer: `Palot-0.12.0-beta.1-win-x64.exe`, 250,581,287 bytes, SHA-256
  `cbfda8fcaaabad689d2cff9b2d7bc689311adc7d29f389ce20fa70757c065525`.
- Signature: `NotSigned`. This is allowed only for the Beta and remains a hard blocker for the stable
  release.
- Windows 11 Pro x64 build 26200: passed as a non-administrator user from an installation path with
  spaces, with no system Git, OpenCode, or Docker available on `PATH`.
- Upgrade: the public `v0.12.0-beta.0` installer, verified as SHA-256
  `90243ef434ca8ae1ea79e39af75dab824675d3c5e9a40a05e5f1348bc865e597`, upgraded to
  `v0.12.0-beta.1` while preserving isolated XDG and Electron user data. The preceding `v0.11.0` to
  `v0.12.0-beta.0` gate also passed. Silent uninstall removed the application and preserved the same
  user data.
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
  local Agent smoke data was present in the packaged application.

This baseline qualifies the package for unsigned Beta testing. A trusted Authenticode signature,
timestamp, signed upgrade test, and automatic-update test are still required before `v0.12.0` can be
published as stable.
