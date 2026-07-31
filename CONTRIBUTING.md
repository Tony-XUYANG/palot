# Contributing to Palot

Thanks for your interest in contributing to Palot! This document covers the basics for
getting started.

## Prerequisites

- [Bun](https://bun.sh) 1.3.8+
- [OpenCode CLI](https://opencode.ai) installed and configured with at least one AI provider

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Start the Electron dev server: `cd apps/desktop && bun run dev`

For frontend-only development (no Electron):

```bash
# Terminal 1
cd apps/server && bun run dev     # port 3100

# Terminal 2
cd apps/desktop && bun run dev:web  # port 1420
```

## Project Structure

```
apps/
  desktop/       Electron 40 + Vite + React 19 desktop app
  server/        Bun + Hono backend (browser-mode dev only)
packages/
  ui/            Shared shadcn/ui component library (@palot/ui)
  configconv/    Universal agent config converter
  configconv-cli/ CLI wrapper for the config converter
```

See [AGENTS.md](AGENTS.md) for detailed code style conventions, naming patterns, and
architectural notes.

## Development Workflow

1. Create a feature branch from `main`: `git checkout -b feature/my-feature`
2. Make your changes
3. Run quality checks:

```bash
bun run lint         # Lint with Biome
bun run check-types  # Type-check all packages
```

4. Run tests (if applicable):

```bash
cd packages/configconv && bun test
```

5. Add a changeset describing your changes:

```bash
bun changeset
```

6. Open a pull request against `main`

## Code Style

Palot uses [Biome](https://biomejs.dev/) for linting and formatting. Key conventions:

- **Indentation:** Tabs (width 2)
- **Quotes:** Double quotes
- **Semicolons:** None
- **Trailing commas:** Everywhere
- **File names:** `kebab-case.ts` / `kebab-case.tsx`
- **Components:** `PascalCase`
- **Functions/variables:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE`

Run `bun run lint:fix` to auto-fix formatting issues.

## Commit Messages

Write concise commit messages that describe the "why" rather than the "what."
Use conventional prefixes when appropriate: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.

## Changesets

All user-facing changes should include a changeset. Run `bun changeset` and follow the
prompts to select affected packages, bump type (patch/minor/major), and a short description.
This is used to generate changelogs and version bumps automatically.

## Windows Release Gate

Prepare and package the Windows x64 installer from `apps/desktop`:

```powershell
bun run package:win
```

Run the installer, bundled-runtime, upgrade, launch, uninstall, and data-preservation
smoke test from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-windows-installer.ps1 `
  -InstallerPath .\apps\desktop\release\Palot-0.11.0-win-x64.exe `
  -AllowUnsigned
```

`-AllowUnsigned` is only for explicit prerelease testing. Stable Windows releases must
have a valid Authenticode signature. Configure these GitHub Actions secrets before a
stable release:

- `WINDOWS_CSC_LINK`: electron-builder-compatible PFX data or certificate URL
- `WINDOWS_CSC_KEY_PASSWORD`: password for the signing certificate

The Release workflow runs the installer smoke test on `windows-latest`. It rejects an
unsigned stable version, while a version containing a prerelease suffix may explicitly
run the unsigned gate.

## Pull Requests

- Keep PRs focused on a single change
- Include a clear description of what changed and why
- Make sure CI passes (lint, type-check, build)
- Link related issues if applicable

## Reporting Bugs

Open an issue on [GitHub](https://github.com/Tony-XUYANG/palot/issues) with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Your OS, Palot version, and OpenCode version

## License

By contributing to Palot, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
