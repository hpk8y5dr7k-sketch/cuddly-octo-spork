# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`cuddly-octo-spork` is an "awesome list" repository: `README.md` is the list itself (currently just the title — no entries yet), and the only automation is a CI check that lints newly-added list entries.

## How the lint check works

`.github/workflows/awesome-lint.yml` runs on every PR into `main` that touches `README.md`. It invokes `.github/scripts/lint-new-entry.sh`, which:

1. Diffs the PR against `origin/main` and looks for added lines (`+`) in `README.md` matching `https://...#readme`.
2. Extracts the repo URL (strips the trailing `#readme`).
3. Clones that repo into `cloned/` and runs `npx awesome-lint` against it.
4. If no line matching that pattern was added, the check exits quietly (no-op) — it only validates newly linked repos, not the whole file.

Implication for adding entries to `README.md`: new list entries must link to the target repo's README using the `https://github.com/<owner>/<repo>#readme` form for the CI check to pick them up and lint the linked project.

## MCP configuration

`.mcp.json` declares project-scoped MCP servers (HTTP transport): `robinhood-trading` and `notion`. These were added as standalone commits (see git history) rather than being wired into any application code — there is currently no app code in this repo that consumes them.
