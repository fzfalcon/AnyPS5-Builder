# Architecture

## Channels

### Stable
Read `https://api.github.com/repos/boykopovar/AnyPS5/releases/latest`. Select only assets that match the host/target platform and belong to that release. The UI must show the tag, release date, asset names, and download progress.

### Experimental
Read the official `main` branch commit and build from source in CI. Label artifacts with the full upstream commit SHA and build date. A scheduled check can detect new commits; it should not automatically promote experimental artifacts to stable.

## Platform distinction

The app UI can be cross-platform, but the conversion target is a separate setting. Windows output requires the Windows relinker and Windows system libraries; Linux output requires Linux libraries; macOS output needs the upstream macOS target and compatible runtime support. Do not assume every upstream release publishes every platform's prebuilt assets.

## Security
- Use the official `boykopovar/AnyPS5` repository as the sole upstream source.
- Treat downloaded release assets as untrusted until checksums/signatures are validated where available.
- Do not run downloaded executables automatically after updating.
- Do not send user game files to the website or telemetry service.
- Do not download or distribute game dumps, firmware, keys, or proprietary content.
