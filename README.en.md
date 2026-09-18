# FastAgent

[![CI](https://github.com/Rainron/FastAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/Rainron/FastAgent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[中文文档](README.md)

FastAgent is a **local-first AI Agent workspace for coding**. Bring your own model API key, select a project directory, and let the agent inspect code, edit files, run commands, and work through planned tasks. Sessions, settings, and credentials remain on the local machine under `~/.fa` and do not pass through a FastAgent relay service.

- Engine: embedded [pi coding-agent](https://github.com/earendil-works/pi) runtime
- Stack: Electron 43, React 19, TypeScript, Tailwind 4, and better-sqlite3
- Platform: Windows (the sandbox and bundled toolchain currently target Windows)
- License: MIT

## Project status

FastAgent is an early public release focused on the Windows local development experience and strong safety boundaries. Feedback on documentation, tests, compatibility, and security is welcome. The roadmap is directional rather than date-based; user-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md).

If you would like to contribute, please read [CONTRIBUTING.md](CONTRIBUTING.md). For potential security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Core capabilities

**Bring your own model, with no required backend**  
Includes presets for OpenAI, Anthropic, DeepSeek, Qwen, Zhipu GLM, Kimi, MiniMax, Google Gemini, and OpenRouter. Any OpenAI-compatible endpoint can also be configured. API keys are stored in a dedicated encrypted table rather than a plaintext cache.

**Chat and agent modes**  
`chat` is read-only. `agent` enables file editing, shell commands, and todo management. The active mode controls which tools the model can access.

**Plan mode**  
Write operations are rejected outside the permission layer while plan mode is active. The agent can inspect the code and produce a step-by-step plan, then execute only after confirmation.

**Permissions and approvals**  
Three built-in profiles (ask, workspace, and full access) plus custom profiles. Rules use last-match-wins resolution and support one-time or persistent approvals. Global deny rules protect operations such as `rm -rf *` and `git push --force`; private-key files are always rejected. Repeated identical operations trigger the loop guard and return to approval.

**OS-level sandbox**  
A Rust sandbox kernel runs commands under a restricted system account and limits writes to the active workspace. One-time administrator setup is required.

**Execution trace and file-change ledger**  
Tool calls, approvals, and durations are archived by turn. After write operations, the application checks the filesystem and reports the final files and line changes instead of relying only on the agent's description.

**Read-only subagents**  
The main agent can delegate research tasks to subagents with narrowed read-only tool access and configurable roles.

**Skills, MCP, and plugins**  
Manage and validate local Skills, import MCP servers and test connectivity, export/import capability bundles, and check for updates from configured Hub sources.

**Context management and local workflow tools**  
Provider-reported usage drives context accounting, with automatic summarization and manual compaction. FastAgent also includes a global quick window, session management, workspace file mentions, external-editor support, diagnostics, crash/startup logs, and resumable interrupted runs.

## Quick start

Requirements: Node.js 22+ and Windows 10/11.

```bash
git clone https://github.com/Rainron/FastAgent.git
cd FastAgent
npm install
npm run dev
```

On first launch, add a model connection under **Model Services**. Choose a provider and enter its API key, or configure a custom OpenAI-compatible `baseUrl`. The optional FastAgent account/server tabs are for users who deploy their own backend; the open-source build does not require them.

### Build from source

```bash
npm run package:win
```

This runs the Vite build, builds the Rust sandbox, downloads and verifies the bundled toolchain, and creates an NSIS installer under `release/`. The installer is not code-signed, so Windows SmartScreen may show an “Unknown publisher” warning.

### Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Build the Vite output under `out/` |
| `npm run typecheck` | Run the TypeScript check |
| `npm test` | Run the Vitest suite once |
| `npm run build:native` | Build the Rust sandbox binaries |
| `npm run fetch:runtime` | Download and verify bundled tools |

## Data directory

All application data is stored under `~/.fa`:

```text
~/.fa
├── fastagent.db      sessions, settings, permissions, and capability metadata
├── sessions/         pi session files grouped by user/date/session
├── skills/ mcp/ plugins/
├── attachments/ exports/ backups/
├── cache/ temp/ logs/
```

The **Data & Storage** settings page can open these directories or migrate the entire data root.

## Security boundaries

- **Fail-closed permissions:** unmatched rules require approval rather than allowing access by default.
- **Secret-file protection:** `.env`, `.aws/credentials`, private keys, and similar files are handled independently from permission profiles.
- **Workspace boundary:** paths outside the workspace use a separate `external_directory` permission entry.
- **Sandboxing:** command execution is constrained by operating-system account permissions.
- **Loop guard:** repeated calls beyond the threshold require approval.
- Diagnostic and crash exports redact secrets before leaving the application.

## Architecture

The main process is organized as lifecycle → IPC → domain modules. The renderer is organized as container components → hooks → pure logic modules, with unit tests for pure logic.

- `src/main/`: agent engine, tool runtime, permissions, safety guards, sandbox, local store, and capability registry
- `src/preload/`: typed bridge exposed to the renderer
- `src/renderer/`: React UI organized by workspace, composer, conversation, settings, and features
- `src/shared/`: shared IPC types and rule logic

## What is next

Near-term work focuses on reconnecting tasks after the window closes and bringing capability management and the plugin marketplace together. Longer-term directions include GUI task automation, in-conversation search and model diagnostics, session export and usage reporting, long-term memory, a project knowledge base, and additional workspace tools.

These are directional goals, not dated commitments. Please open an issue if you have a particular use case you would like prioritized.

## Third-party acknowledgements

We are grateful to the maintainers and contributors of the following open-source projects. FastAgent depends on these projects and respects their respective licenses:

| Project | Use in FastAgent | License |
| --- | --- | --- |
| [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi) | Agent runtime | MIT |
| [Electron](https://electronjs.org) / React / Tailwind | Application framework | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Local database | MIT |
| [uiohook-napi](https://github.com/SnosMe/uiohook-napi) | Global keyboard and mouse hooks | MIT |
| ripgrep / fd / jq / 7-Zip / MinGit / Bash | Bundled command-line toolchain | Respective licenses; included under `resources/runtime/*/licenses/` |

For each bundled tool, the original license files are distributed with the packaged application where applicable. Thank you to all upstream maintainers and contributors who make this project possible.

## Contributing

Documentation improvements, tests, compatibility fixes, and security improvements are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and review existing issues before opening a pull request.

## License

[MIT](LICENSE) © 2026 lake
