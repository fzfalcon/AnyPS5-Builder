# AnyPS5 Builder

A cross-platform desktop front end and updater for the upstream [AnyPS5](https://github.com/boykopovar/AnyPS5) project.

> **Status:** Initial project scaffold. The desktop UI and conversion workflow are not implemented yet.

## Goals

- Desktop app for Windows, Linux, and macOS.
- Project website with documentation and GitHub Releases downloads.
- Stable channel: check upstream AnyPS5 releases and acquire matching converter/runtime assets.
- Experimental channel: build from the latest upstream source in CI and publish clearly labelled builds.
- Validate input files and show actionable conversion diagnostics.
- Never bundle or download commercial game content, firmware, keys, or decrypted executables.

## Important versioning rule

The relinker and system-library package must come from the same upstream release or the same recorded source commit/build. Do not mix files from different revisions.

## Planned structure

- `app/` — desktop UI (planned; Tauri + web UI is the proposed direction)
- `updater/` — upstream release/source metadata checks
- `website/` — project site
- `compatibility/` — test results and known issues
- `.github/workflows/` — scheduled upstream checks and manual CI builds

## Upstream

- Source: https://github.com/boykopovar/AnyPS5
- Usage guide: https://github.com/boykopovar/AnyPS5/blob/main/docs/user/USAGE.md
- Releases: https://github.com/boykopovar/AnyPS5/releases

## License

AnyPS5 is GPL-2.0-only. Before distributing modified or combined binaries, review the upstream license and comply with applicable source-distribution and notice requirements. This scaffold does not include upstream source or binaries.
