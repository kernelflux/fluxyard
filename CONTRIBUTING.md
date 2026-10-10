# Contributing to Fluxyard

Contributions that improve the personal desktop workflow, reliability and usable
outputs are welcome. Discuss major features in an issue before implementing them.

## Workflow

`main` is the only permanent branch. Use short-lived `feat/*` or `fix/*` branches,
open a pull request, pass checks and review, then merge and remove the branch.
Stable and preview releases use immutable version tags and GitHub Releases.
Respect required checks and branch protection; do not rewrite shared history as a
routine development practice.

## Development checks

Use Node.js 22.19+ and pnpm 11.7.0. Follow the README to set up the desktop/runtime.
Run these checks before proposing a change:

```bash
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm fluxyard demo
pnpm fluxyard runtime demo
```

Changes to desktop behavior also need validation in the actual packaged app.
Keep consumer features in the existing conversation/settings surfaces, preserve
session state and reuse approval-aware Harness tools. Enterprise administration
belongs to a separate application. Keep runtime-neutral packages framework-neutral.

## Repository hygiene

Commit source, meaningful tests, lockfiles and public documentation. Keep AI
conversation logs, local agent/skill instructions, exploratory documents, build
outputs, credentials and personal runtime state out of Git. The ignored `docs/`
folder is for local development records; publish user-facing documentation in
explicitly tracked files such as the READMEs and this guide.

## Licensing

The project is maintained by kernelflux under Apache-2.0. Contributions must be
compatible with that license. Retain third-party copyrights and notices; identify
the origin and license of any imported code or assets.
