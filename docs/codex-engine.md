# Codex Engine Compatibility

Palot currently exposes OpenAI Codex models through the bundled OpenCode server. Users can connect
with an official ChatGPT OAuth method offered by OpenCode or with an OpenAI API key. Account,
billing, model access, region, and network requirements remain controlled by OpenAI.

## Engine Boundary

The Electron main process defines a shared `AgentEngine` contract for lifecycle, authentication
status, sessions, explicit model prompts, global events, cancellation, and diffs. OpenCode is the
only enabled engine in the `v0.12` line. The preload bridge exposes read-only engine descriptors so
future UI work can discover capabilities without reading credentials.

The official Codex CLI probe follows this order:

1. Explicit test override.
2. A future bundled Windows x64 runtime.
3. Development PATH fallback.

Packaged Windows builds never replace a missing bundled runtime with a user or PATH binary. The
probe executes only `--version` and `app-server --help`; it never starts authentication or reads
Codex configuration. Detecting a compatible CLI does not enable the engine.

## Enablement Gate

The official Codex engine remains disabled until all of the following are complete:

- Pin a standalone Windows x64 CLI release and record its SHA-256, source, and Apache-2.0 notice.
- Reject unsafe archive paths before extraction and include the runtime in installer smoke tests.
- Confirm a stable structured app-server or documented non-interactive JSON protocol.
- Implement authentication, session, prompt, event, cancellation, diff, and restart behavior.
- Store Codex credentials separately from OpenCode and never import credentials from CC Switch.
- Complete a real code edit, review diff, and automated check with an authorized account.

If any gate fails, Palot continues to use the OpenCode OpenAI Provider. Interactive terminal output
must never be scraped as an integration protocol.
