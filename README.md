# Fluxyard

**From intent to work.**

A local-first desktop workspace for AI-assisted work, built on
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Fluxyard brings conversations, project files, model configuration and practical
outputs into one desktop application.

[简体中文](README.zh-CN.md) · [Contributing](CONTRIBUTING.md) · [License](LICENSE)

## What is Fluxyard?

Fluxyard is the personal workspace for turning a request into useful work. Open a
project, describe your task, choose a model and control what the agent can do.
Your sessions and workspace state stay on your computer; model requests use the
provider you configure. Local-first does not mean models run offline.

The personal desktop is the current product. Enterprise Agent management is a
separate future application, with its own distribution, identity and data. It
will build on the shared runtime-neutral foundations without adding enterprise
administration to the personal workspace.

**Status:** preview, desktop **0.4.5**. The current packaged target is **macOS
Apple Silicon (ARM64)**. Windows/Linux distribution, macOS signing and
notarization are not available yet.

## Design foundation

- **One workspace:** one window, one conversation interface and one settings
  hierarchy. Launch loads directly into the main page; connection diagnostics
  are available from Help when needed.
- **Local ownership:** preserve sessions and project state across restarts and
  upgrades. No model API key is bundled with the application.
- **Composable capabilities:** features contribute Harness Host services and
  existing client slots, with state bound to the current session.
- **Explicit execution boundaries:** reuse Harness sandbox and approval policies;
  keep the Electron renderer sandbox separate from agent file permissions.
- **Shared foundations, separate products:** runtime-neutral packages support
  lifecycle, inventory and usage facts independently of the desktop interface.

## Built on DeepSeek Harness

Harness provides the agent framework, conversation UI, model configuration,
plugin surfaces, permission presets and Office workflows. Fluxyard integrates
that foundation rather than implementing another agent engine.

| Area | Fluxyard contribution |
| --- | --- |
| Desktop delivery | Electron application with a locked Harness dependency graph; Harness runs using Electron's bundled Node, so end users do not install Node separately. |
| Startup | Automatic local service startup, a loading state followed by the main page, and model credentials configured in Settings instead of a blocking first-launch prompt. |
| Native window | macOS sidebar window controls and fullscreen support, with checked adapters for the pinned Harness version and browser shortcut routing. |
| Runtime lifecycle | Authenticated loopback Web service, owned-process cleanup, recovery diagnostics and a separate SDK lifecycle adapter. |
| Presentation workspace | A PPT action in the existing conversation input area; session-bound title, outline and style, content preview, durable saving and editable PPTX download. |
| Session context | An explicit option includes the saved presentation outline in the current session's next context snapshot without starting a model request or adding tools. |
| Packaging | Preserved runtime assets and license notices, target-specific dependency pruning, resource checks and compressed macOS DMGs. |

The desktop does **not** expose an unrestricted Electron filesystem/process bridge
to agent content. Model operations continue through Harness tools and approvals.

## Use the desktop

Packaged downloads will be published through [GitHub Releases](https://github.com/kernelflux/fluxyard/releases).
Until a release artifact is published, build the preview using the steps below.

1. Open Fluxyard. The local service starts automatically and the main workspace loads.
2. Open **Settings → Models** and configure your provider's API key.
3. Select or add a workspace, then start a conversation.
4. Choose the session's access mode before requesting file changes. A settings
   default affects new sessions; the conversation control applies to the current one.
5. To prepare a presentation, select **PPT** beneath the conversation input.
   Edit the title and outline, select a style, save and export an editable PPTX.

In the presentation outline, each paragraph is a slide: the first line is its
heading and the following lines are bullet points. Separate slides with a blank
line. The current editor accepts up to 12 slides and 8 bullet points per slide.
The preview shows content, not a pixel-exact rendering of the exported PPTX.

Selecting **Use the saved outline in this conversation** and saving makes it
available to the next session request. It does not automatically call a model.
Manual outline export is implemented; end-to-end model-generated presentations
have not yet been validated. Plugin management uses the Harness interface; a
Fluxyard marketplace installer is not implemented yet.

## Framework and repository

| Layer | Technology / package |
| --- | --- |
| Desktop carrier | Electron 43.0.0, sandboxed WebContentsView, isolated preload |
| Agent framework | DeepSeek Harness 0.2.0-rc.2 and Cordis plugin composition |
| Consumer extensions | TypeScript Host services and React client-slot contributions |
| Presentation export | PptxGenJS 4.0.1, editable text and shapes |
| Development | pnpm workspace, TypeScript, esbuild and Vitest |

```text
apps/desktop/                 Desktop app, runtime distribution and packaging
apps/cli/                     Runtime diagnostics and foundation demos
packages/harness-extensions/  Session-bound consumer capabilities
packages/runtime-node/        Runtime lifecycle and Harness adapter
packages/core/                Runtime-neutral domain foundations
packages/store-json/          Local persistence
```

## Build and develop

Source development requires **Node.js 22.19+** and **pnpm 11.7.0**. Packaged users
need neither Node nor pnpm. Initial dependency installation and packaging require
network access; model use requires access to the configured provider.

```bash
pnpm install --frozen-lockfile
pnpm --filter @fluxyard/desktop setup
```

For source development, install the pinned external runtime and launch:

```bash
npm ci --prefix apps/desktop/runtime --omit=dev --registry=https://registry.npmjs.org
FLUXYARD_HARNESS_INSTALLATION="$PWD/apps/desktop/runtime" pnpm dev:desktop
```

Source mode uses an external runtime and standard development window chrome.
Validate the bundled consumer extensions and native integration in the packaged app.
The source desktop stores its local state under `.fluxyard/desktop/`; set
`FLUXYARD_DESKTOP_DATA` to use another directory.

On macOS ARM64, build the self-contained preview:

```bash
pnpm package:desktop
```

Artifacts are written to `apps/desktop/release/`:

- `0.4.5/Fluxyard-darwin-arm64/Fluxyard.app`
- `Fluxyard-0.4.5-darwin-arm64.dmg` and its SHA-256 checksum
- `size-report.json`

The current DMG is approximately 244.5 MB. Open it and drag the app to Applications.
This preview is not Developer ID signed or notarized.

## Verification and contribution

```bash
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm fluxyard demo
pnpm fluxyard runtime demo
```

The packaged executable also accepts `--smoke` to verify SDK startup/shutdown,
authenticated Web startup and consumer plugin loading without model requests.
These checks do not establish model quality or complete task execution.

`main` is the only permanent branch. Use short-lived feature/fix branches and
pull requests; distinguish stable and preview releases with version tags and
GitHub Releases. See [CONTRIBUTING.md](CONTRIBUTING.md).

AI work logs, local agent instructions and exploratory documents are intentionally
excluded from version control. Public documentation describes the product and its
supported behavior, rather than recording the development conversation.

## License and attribution

Copyright © 2026 **kernelflux**. Fluxyard's original source is licensed under the
**Apache License 2.0**. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

DeepSeek Harness and Cordis are MIT-licensed; Electron and PptxGenJS are
MIT-licensed. Their copyrights and the licenses of transitive dependencies remain
with their respective owners. Packaged distributions retain dependency manifests,
license files and Electron notices. Fluxyard is an independent project and is not
an official DeepSeek desktop distribution.
