# Codex Engine Compatibility

Palot currently exposes OpenAI Codex models through the bundled OpenCode server. Users can connect
with an official ChatGPT OAuth method offered by OpenCode or with an OpenAI API key. Account,
billing, model access, region, and network requirements remain controlled by OpenAI.

## Engine Boundary

The Electron main process defines an engine-neutral `AgentEngine` contract for lifecycle,
authentication status, sessions, explicit model prompts, global events, cancellation, and diffs.
OpenCode SDK types are mapped inside the OpenCode adapter and are not exposed through this contract.
OpenCode is the only enabled engine in the `v0.12` line. The preload bridge exposes read-only engine
descriptors so future UI work can discover capabilities without reading credentials.

The official Codex CLI probe follows this order:

1. Explicit test override.
2. A future bundled Windows x64 runtime.
3. Development PATH fallback.

Packaged Windows builds never replace a missing bundled runtime with a user or PATH binary. The
probe executes only `--version` and `app-server --help`; it never starts authentication or reads
Codex configuration. Detecting a compatible CLI does not enable the engine.

## v0.13 Preview Infrastructure

The repository contains a disabled adapter and a separate `codex-preview-manifest.json`. It pins
official Codex `0.146.0`, package and executable SHA-256 values, source, and Apache-2.0 license. The
stable Windows runtime manifest and electron-builder resources do not consume this preview manifest,
so Codex is not added to a `v0.12` installer.

The preview starts an absolute executable path with `app-server --listen stdio:// --strict-config`,
uses an isolated `CODEX_HOME`, and communicates using newline-delimited JSON-RPC. The adapter covers
initialize, account status, browser login start, model listing, thread creation, turns, interrupt,
events, and unified diff updates. It defaults to approval policy `never` and workspace-write sandbox.
It returns the browser URL to the caller and never reads or copies OAuth tokens.

Transport tests cover framing, concurrent request correlation, malformed lines, timeouts, process
exit, notification streaming, cancellation, and diff mapping. This code is not registered as an
active engine until the real authentication, edit, check, recovery, and restart acceptance gates pass.

## Enablement Gate

The official Codex engine remains disabled until all of the following are complete:

- Re-audit the pinned standalone Windows x64 CLI release before packaging it.
- Reject unsafe archive paths before extraction and include the runtime in installer smoke tests.
- Confirm the experimental app-server protocol remains compatible with the generated schema.
- Complete process restart and session recovery behavior after an unexpected exit.
- Store Codex credentials separately from OpenCode and never import credentials from CC Switch.
- Complete a real code edit, review diff, and automated check with an authorized account.

If any gate fails, Palot continues to use the OpenCode OpenAI Provider. Interactive terminal output
must never be scraped as an integration protocol.
