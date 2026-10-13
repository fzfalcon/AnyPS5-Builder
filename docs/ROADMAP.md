# Roadmap

## Phase 1 — Reliable upstream tracking
- [ ] Query official GitHub Releases API.
- [ ] Query the official `main` branch commit.
- [ ] Show stable release and latest-source revisions separately.
- [ ] Verify asset checksums when published; record SHA-256 locally otherwise.
- [ ] Never silently overwrite a working toolchain.

## Phase 2 — Desktop shell
- [ ] Tauri-based UI for Windows, Linux, and macOS.
- [ ] Choose input ELF or game folder.
- [ ] Choose Windows, Linux, or macOS output.
- [ ] Validate required module directory and output paths.
- [ ] Show progress, logs, and error details.

## Phase 3 — Engine integration
- [ ] Download matching official release assets by platform.
- [ ] Support user-selected experimental CI builds.
- [ ] Package relinker and matching system libraries together.
- [ ] Keep game assets local; never upload game dumps to a server.

## Phase 4 — Testing and releases
- [ ] CI builds for supported OSes.
- [ ] Smoke tests and checksums.
- [ ] Website download page and setup guides.
- [ ] Compatibility reports clearly distinguish conversion success from gameplay success.
