
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import "./App.css";

type Platform = "Windows" | "Linux" | "macOS";
type Channel = "Stable" | "Experimental";

type ReleaseAsset = {
  name: string;
  size: number;
  download_url: string;
  sha256_digest: string | null;
};

type DownloadProgress = {
  download_id: string;
  asset_name: string;
  received: number;
  total: number;
  percent: number;
};

type LocalAsset = {
  name: string;
  version: string;
  path: string;
  size: number;
  modified_at: string | null;
};

type ReleaseInfo = {
  version: string;
  name: string | null;
  release_url: string;
  published_at: string | null;
  notes: string | null;
  assets: ReleaseAsset[];
};

export default function App() {
  const [platform, setPlatform] = useState<Platform>("Windows");
  const [channel, setChannel] = useState<Channel>("Stable");
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRequestedRef = useRef(false);
  const activeDownloadRef = useRef(false);
  const activeDownloadIdRef = useRef<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    listen<DownloadProgress>("download-progress", (event) => {
      if (event.payload.download_id === activeDownloadIdRef.current) {
        setDownloadProgress(event.payload);
      }
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    }).catch((err) => {
      console.error("Could not subscribe to download progress:", err);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const [activeView, setActiveView] = useState<"Dashboard" | "Asset Manager" | "Converter" | "Compatibility">("Dashboard");
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const [compatibilityMarkdown, setCompatibilityMarkdown] = useState("");
  const [compatibilityLoading, setCompatibilityLoading] = useState(false);
  const [compatibilityError, setCompatibilityError] = useState("");

  const [logs, setLogs] = useState<string[]>([
    "AnyPS5 Builder initialized",
    "Upstream: boykopovar/AnyPS5",
    "Ready to check for updates",
  ]);

  function log(message: string) {
    setLogs((items) => [
      ...items,
      `${new Date().toLocaleTimeString()} — ${message}`,
    ]);
  }

  async function checkUpdates() {
    if (channel === "Experimental") {
      setError(
        "Experimental channel is not connected yet. The current backend checks official stable releases only.",
      );
      log("Experimental update check unavailable");
      return;
    }

    setChecking(true);
    setError("");
    log("Checking official AnyPS5 stable release…");

    try {
      const result = await invoke<ReleaseInfo>("latest_release");
      setRelease(result);
      log(`Official release found: ${result.version}`);
      log(`${result.assets.length} release assets listed`);
    } catch (err) {
      const message =
        typeof err === "string" ? err : "Could not retrieve release information.";
      setError(message);
      log(`Update check failed: ${message}`);
    } finally {
      setChecking(false);
    }
  }

  async function downloadAsset(asset: ReleaseAsset) {
    if (!release || activeDownloadRef.current) return;

    activeDownloadRef.current = true;
    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeDownloadIdRef.current = downloadId;
    cancelRequestedRef.current = false;
    setCancelRequested(false);
    setDownloadProgress({
      download_id: downloadId,
      asset_name: asset.name,
      received: 0,
      total: asset.size,
      percent: 0,
    });
    setDownloading(asset.name);
    setError("");
    log(`Starting official download: ${asset.name}`);

    try {
      const result = await invoke<{
        name: string;
        path: string;
        bytes_written: number;
        sha256: string;
        digest_verified: boolean;
      }>("download_release_asset", {
        downloadId,
        assetName: asset.name,
        expectedVersion: release.version,
      });

      if (cancelRequestedRef.current) {
        log(`Download cancelled: ${asset.name}`);
        return;
      }

      setDownloadProgress((current) =>
        current && current.asset_name === asset.name
          ? { ...current, received: result.bytes_written, percent: 100 }
          : current,
      );
      log(`Download completed: ${result.name}`);
      log(`Saved to: ${result.path}`);
      log(
        result.digest_verified
          ? `SHA-256 verified: ${result.sha256}`
          : `SHA-256 calculated but not verified against a published digest: ${result.sha256}`,
      );

      window.alert(
        `Download completed!\\n\\nFile: ${result.name}\\nSize: ${formatSize(result.bytes_written)}\\nSHA-256: ${result.digest_verified ? "Verified" : "Not independently verified"}\\n\\nSaved to:\\n${result.path}`,
      );
    } catch (err) {
      const message =
        typeof err === "string" ? err : "The asset download failed.";

      if (cancelRequestedRef.current) {
        log(`Download cancelled: ${asset.name}`);
      } else {
        setError(message);
        log(`Download failed: ${asset.name} — ${message}`);
      }
    } finally {
      activeDownloadRef.current = false;
      if (activeDownloadIdRef.current === downloadId) {
        activeDownloadIdRef.current = null;
      }
      cancelRequestedRef.current = false;
      setCancelRequested(false);
      setDownloading(null);
    }
  }

  async function cancelActiveDownload() {
    if (!activeDownloadRef.current || cancelRequestedRef.current) return;

    cancelRequestedRef.current = true;
    setCancelRequested(true);
    log("Cancellation requested…");

    try {
      const downloadId = activeDownloadIdRef.current;
      if (!downloadId) {
        throw new Error("There is no active download to cancel.");
      }
      await invoke("cancel_download", { downloadId });
    } catch (err) {
      const message =
        typeof err === "string" ? err : "Could not request cancellation.";
      setError(message);
      log(`Cancellation request failed: ${message}`);
      cancelRequestedRef.current = false;
      setCancelRequested(false);
    }
  }

  async function refreshLocalAssets() {
    setAssetsLoading(true);
    setAssetsError("");

    try {
      const result = await invoke<LocalAsset[]>("list_downloaded_assets");
      setLocalAssets(result);
      log(`Asset Manager refreshed: ${result.length} file(s) found`);
    } catch (err) {
      const message =
        typeof err === "string" ? err : "Could not list downloaded assets.";
      setAssetsError(message);
      log(`Asset Manager refresh failed: ${message}`);
    } finally {
      setAssetsLoading(false);
    }
  }

  async function loadCompatibility() {
    setCompatibilityLoading(true);
    setCompatibilityError("");
    try {
      let markdown: string;

      if ("__TAURI_INTERNALS__" in window) {
        markdown = await invoke<string>("fetch_compatibility_markdown");
      } else {
        const response = await fetch(
          "https://raw.githubusercontent.com/boykopovar/AnyPS5/main/docs/user/COMPATIBILITY.md",
          { headers: { Accept: "text/plain" } }
        );

        if (!response.ok) {
          throw new Error(`Compatibility request failed: HTTP ${response.status}`);
        }

        markdown = await response.text();
      }

      setCompatibilityMarkdown(markdown);
      log("Official compatibility document loaded");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Could not load official compatibility data. The browser may block the request.";
      setCompatibilityError(message);
      log("Compatibility load failed: " + message);
    } finally {
      setCompatibilityLoading(false);
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const publishedDate = release?.published_at
    ? new Date(release.published_at).toLocaleDateString()
    : "Not provided";

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">A</div>
          <div>
            <strong>AnyPS5 Builder</strong>
            <small>DEVELOPMENT BUILD</small>
          </div>
        </div>

        <p className="nav-label">WORKSPACE</p>
        <button
          className={`nav ${activeView === "Dashboard" ? "active" : ""}`}
          onClick={() => setActiveView("Dashboard")}
        >
          ▦ &nbsp; Dashboard
        </button>
        <button
          className={`nav ${activeView === "Asset Manager" ? "active" : ""}`}
          onClick={() => {
            setActiveView("Asset Manager");
            void refreshLocalAssets();
          }}
        >
          ⇩ &nbsp; Asset Manager
        </button>
        <button
          className={`nav ${activeView === "Converter" ? "active" : ""}`}
          onClick={() => setActiveView("Converter")}
        >
          ▷ &nbsp; Converter
        </button>
        <button
          className={`nav ${activeView === "Compatibility" ? "active" : ""}`}
          onClick={() => setActiveView("Compatibility")}
        >
          ◈ &nbsp; Compatibility
        </button>

        <div className="sidebar-status">
          <span className="dot" /> Interface ready
          <small>v0.1.0-dev</small>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <span>Workspace / Dashboard</span>
          <a
            href="https://github.com/boykopovar/AnyPS5"
            target="_blank"
            rel="noreferrer"
          >
            Official upstream ↗
          </a>
        </header>

        <div className="content">
          {activeView === "Asset Manager" ? (
            <>
              <div className="heading">
                <div>
                  <p className="eyebrow">LOCAL LIBRARY</p>
                  <h1>Asset Manager</h1>
                  <p className="muted">
                    Manage files downloaded through the official release checker.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => void refreshLocalAssets()}
                  disabled={assetsLoading}
                >
                  {assetsLoading ? "Refreshing…" : "↻ Refresh assets"}
                </button>
              </div>

              {assetsError && (
                <div className="notice" role="alert">
                  <strong>Could not load assets</strong>
                  <p>{assetsError}</p>
                </div>
              )}

              <article className="panel release-panel">
                <p className="eyebrow">DOWNLOADED FILES</p>
                <h2>{localAssets.length} asset(s)</h2>
                {assetsLoading ? (
                  <p className="muted">Scanning the application download directory…</p>
                ) : localAssets.length === 0 ? (
                  <p className="muted">
                    No downloaded assets found. Download an official release asset first,
                    then refresh this screen.
                  </p>
                ) : (
                  <div className="asset-list">
                    {localAssets.map((asset) => (
                      <div className="asset-row" key={`${asset.version}-${asset.name}`}>
                        <div>
                          <strong>{asset.name}</strong>
                          <p className="hint">
                            Version {asset.version} · {formatSize(asset.size)}
                          </p>
                          <p className="hint">{asset.path}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </>
          ) : activeView === "Converter" ? (
            <>
              <div className="heading"><div><p className="eyebrow">CONVERSION WORKSPACE</p><h1>Converter</h1><p className="muted">Local asset workspace.</p></div></div>
              <article className="panel"><h2>Local assets</h2><p>{localAssets.length} asset(s) detected.</p>{localAssets.map((asset) => <p key={asset.name}>{asset.name}</p>)}<p className="muted">Conversion is not implemented yet.</p></article>
            </>
          ) : activeView === "Compatibility" ? (
            <>
              <div className="heading">
                <div>
                  <p className="eyebrow">OFFICIAL UPSTREAM DATA</p>
                  <h1>Compatibility</h1>
                  <p className="muted">Compatibility information fetched from the official AnyPS5 repository.</p>
                </div>
                <button className="primary" onClick={() => void loadCompatibility()} disabled={compatibilityLoading}>
                  {compatibilityLoading ? "Loading…" : "↻ Refresh data"}
                </button>
              </div>
              <article className="panel" style={{ marginBottom: "16px" }}><p className="eyebrow">COMMUNITY PROJECT</p><h2>Live Compatibility Roadmap</h2><p className="muted">Explore per-game development stages, open blockers, library progress, and GPU coverage. Development progress does not guarantee a game is playable.</p><p><a href="https://alxcbtw.github.io/anyps5-roadmap/" target="_blank" rel="noreferrer">Open Live Roadmap ↗</a></p><p><a href="https://github.com/AlxcBTW/anyps5-roadmap" target="_blank" rel="noreferrer">View roadmap source on GitHub ↗</a></p></article><article className="panel" style={{ marginBottom: "16px" }}><p className="eyebrow">COMMUNITY TEST REPORTS</p><h2>Game Bring-up Discussions</h2><p className="muted">Read community test reports and investigate individual game titles.</p><p><a href="https://github.com/boykopovar/AnyPS5/discussions/categories/game-bring-up" target="_blank" rel="noreferrer">Open Game Bring-up Discussions ↗</a></p></article>
              {compatibilityError && <div className="notice" role="alert"><strong>Could not load compatibility data</strong><p>{compatibilityError}</p></div>}
              <article className="panel">
                <h2>Official compatibility document</h2>
                {!compatibilityMarkdown && !compatibilityLoading && <p className="muted">Click Refresh data to retrieve the latest document.</p>}
                {compatibilityLoading && <p className="muted">Fetching official Markdown…</p>}
                {compatibilityMarkdown && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "60vh", overflowY: "auto" }}>{compatibilityMarkdown}</pre>}
              </article>
            </>
          ) : (
          <>
          <div className="heading">
            <div>
              <p className="eyebrow">CONTROL CENTER</p>
              <h1>AnyPS5 Builder</h1>
              <p className="muted">
                Manage upstream tools, platforms and conversion tasks.
              </p>
            </div>
            <button
              className="primary"
              onClick={checkUpdates}
              disabled={checking}
            >
              {checking ? "Checking…" : "↻ Check updates"}
            </button>
          </div>

          <div className="notice">
            <strong>ⓘ &nbsp; Live release checker</strong>
            <p>
              Stable update checks query the official AnyPS5 GitHub Releases
              API. Release availability does not guarantee game compatibility.
            </p>
          </div>

          {error && (
            <div className="notice" role="alert">
              <strong>Update check unavailable</strong>
              <p>{error}</p>
            </div>
          )}

          <div className="stats">
            <article className="panel stat">
              <span className="eyebrow">LATEST STABLE</span>
              <h2>{release?.version ?? "Not checked"}</h2>
              <p className="muted">
                {release ? `Published ${publishedDate}` : "Check for the latest release"}
              </p>
              {release && (
                <a href={release.release_url} target="_blank" rel="noreferrer">
                  View official release ↗
                </a>
              )}
            </article>

            <article className="panel stat">
              <span className="eyebrow">UPSTREAM</span>
              <h2>{release ? "Connected" : "Not checked"}</h2>
              <p className="muted">
                {release
                  ? `${release.assets.length} published assets`
                  : "Live refresh available through the desktop backend"}
              </p>
            </article>

            <article className="panel stat">
              <span className="eyebrow">TARGET PLATFORM</span>
              <h2>{platform}</h2>
              <p className="muted">Selected target platform</p>
            </article>
          </div>

          <div className="columns">
            <article className="panel">
              <p className="eyebrow">CONFIGURATION</p>
              <h2>Build settings</h2>

              <label htmlFor="platform">Target platform</label>
              <select
                id="platform"
                value={platform}
                onChange={(event) =>
                  setPlatform(event.target.value as Platform)
                }
              >
                <option>Windows</option>
                <option>Linux</option>
                <option>macOS</option>
              </select>
              <p className="hint">
                Only use assets compatible with the selected platform. macOS
                may require a compatible source build.
              </p>

              <label htmlFor="channel">Update channel</label>
              <select
                id="channel"
                value={channel}
                onChange={(event) =>
                  setChannel(event.target.value as Channel)
                }
              >
                <option>Stable</option>
                <option>Experimental</option>
              </select>
              <p className="hint">
                {channel === "Stable"
                  ? "Checks published official releases."
                  : "Experimental source/build integration is not implemented yet."}
              </p>

              <button
                className="primary full"
                onClick={() => log(`Selected ${platform} / ${channel}`)}
              >
                Apply settings →
              </button>
            </article>

            <article className="panel">
              <div className="log-heading">
                <div>
                  <p className="eyebrow">DIAGNOSTICS</p>
                  <h2>Activity log</h2>
                </div>
                <button className="text-button" onClick={() => setLogs([])}>
                  Clear
                </button>
              </div>

              <div className="logs">
                {logs.length ? (
                  logs.map((item, index) => (
                    <div className="log-row" key={`${item}-${index}`}>
                      <span className="log-dot" />
                      <span>{item}</span>
                    </div>
                  ))
                ) : (
                  <p className="muted">No log entries.</p>
                )}
              </div>
            </article>
          </div>

          {release && (
            <article className="panel release-panel">
              <p className="eyebrow">OFFICIAL RELEASE ASSETS</p>
              <h2>{release.name || release.version}</h2>
              <p className="muted">
                Files are obtained from the official upstream release and verified by the desktop backend.
              </p>

              {downloading && downloadProgress?.asset_name === downloading && (
                <div className="notice" aria-live="polite">
                  <strong>
                    {cancelRequested ? "Cancelling download…" : `Downloading ${downloading}`}
                  </strong>
                  <p>
                    {formatSize(downloadProgress.received)} of{" "}
                    {formatSize(downloadProgress.total)} ·{" "}
                    {Math.round(downloadProgress.percent)}%
                  </p>
                  <progress
                    max={100}
                    value={downloadProgress.percent}
                    style={{ width: "100%" }}
                    aria-label="Download progress"
                  />
                  <button
                    className="text-button"
                    onClick={() => void cancelActiveDownload()}
                    disabled={cancelRequested}
                  >
                    {cancelRequested ? "Cancelling…" : "Cancel download"}
                  </button>
                </div>
              )}

              {release.assets.length === 0 ? (
                <p className="muted">No downloadable assets were published.</p>
              ) : (
                <div className="asset-list">
                  {release.assets.map((asset) => (
                    <div className="asset-row" key={asset.name}>
                      <div>
                        <strong>{asset.name}</strong>
                        <p className="hint">
                          {formatSize(asset.size)}
                          {asset.sha256_digest
                            ? ` · ${asset.sha256_digest}`
                            : " · No published digest"}
                        </p>
                      </div>
                      <button
                        className="primary"
                        onClick={() => downloadAsset(asset)}
                        disabled={downloading !== null}
                      >
                        {downloading === asset.name ? "Downloading…" : "Download"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {release.notes && (
                <details>
                  <summary>Release notes</summary>
                  <pre className="release-notes">{release.notes}</pre>
                </details>
              )}
            </article>
          )}

          </>
          )}

          <footer>
            <span>ANYPS5 BUILDER · COMMUNITY PROJECT</span>
            <span>Independent project · Not affiliated with PlayStation</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
