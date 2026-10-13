use serde::{Deserialize, Serialize};
use tauri::Manager;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};

const RELEASES_URL: &str =
    "https://api.github.com/repos/boykopovar/AnyPS5/releases/latest";

#[derive(Debug, Serialize, Deserialize)]
struct GitHubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    published_at: Option<String>,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Serialize)]
struct ReleaseAsset {
    name: String,
    size: u64,
    download_url: String,
    sha256_digest: Option<String>,
}

#[derive(Debug, Serialize)]
struct ReleaseInfo {
    version: String,
    name: Option<String>,
    release_url: String,
    published_at: Option<String>,
    notes: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Serialize)]
struct DownloadResult {
    name: String,
    path: String,
    bytes_written: u64,
    sha256: String,
    digest_verified: bool,
}

#[tauri::command]
fn latest_release() -> Result<ReleaseInfo, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("AnyPS5-Builder")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Could not create HTTP client: {e}"))?;

    let response = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("Could not contact GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub release request failed: {e}"))?;

    let release: GitHubRelease = response
        .json()
        .map_err(|e| format!("Could not parse GitHub release data: {e}"))?;

    if release.draft || release.prerelease {
        return Err("GitHub returned a draft or prerelease instead of a stable release.".into());
    }

    Ok(ReleaseInfo {
        version: release.tag_name,
        name: release.name,
        release_url: release.html_url,
        published_at: release.published_at,
        notes: release.body,
        assets: release
            .assets
            .into_iter()
            .map(|asset| ReleaseAsset {
                name: asset.name,
                size: asset.size,
                download_url: asset.browser_download_url,
                sha256_digest: asset.digest,
            })
            .collect(),
    })
}

#[tauri::command]
fn download_release_asset(
    asset_name: String,
    expected_version: String,
    app: tauri::AppHandle,
) -> Result<DownloadResult, String> {
    // Validate the filename before using it as a path component.
    if asset_name.is_empty()
        || asset_name == "."
        || asset_name == ".."
        || asset_name.contains('/')
        || asset_name.contains('\\')
        || asset_name.contains("..")
        || asset_name.chars().any(char::is_control)
    {
        return Err("Invalid asset filename.".into());
    }

    if expected_version.is_empty()
        || !expected_version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err("Invalid release version.".into());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("AnyPS5-Builder")
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Could not create HTTP client: {e}"))?;

    // Refresh official release metadata and require an exact asset match.
    let release: GitHubRelease = client
        .get(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("Could not contact GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub release request failed: {e}"))?
        .json()
        .map_err(|e| format!("Could not parse GitHub release data: {e}"))?;

    if release.draft || release.prerelease || release.tag_name != expected_version {
        return Err(
            "The requested release is no longer the latest stable release. Refresh the release list and try again."
                .into(),
        );
    }

    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| "This file is not listed in the official release.".to_string())?;

    let parsed_url = reqwest::Url::parse(&asset.browser_download_url)
        .map_err(|e| format!("Invalid official asset URL: {e}"))?;

    if parsed_url.scheme() != "https"
        || parsed_url.host_str() != Some("github.com")
        || !parsed_url.path().starts_with(&format!(
            "/boykopovar/AnyPS5/releases/download/{}/",
            release.tag_name
        ))
    {
        return Err("The asset URL is outside the expected official release.".into());
    }

    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not locate application data directory: {e}"))?;

    let output_dir: PathBuf = base_dir.join("downloads").join(&release.tag_name);
    fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Could not create download directory: {e}"))?;

    let final_path = output_dir.join(&asset_name);

    // Never overwrite a previous download.
    if final_path.exists() {
        return Err(format!(
            "The file already exists at {}. Remove it first if you want to download it again.",
            final_path.display()
        ));
    }

    let part_path = output_dir.join(format!("{asset_name}.part"));
    let mut response = client
        .get(parsed_url)
        .send()
        .map_err(|e| format!("Download request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {e}"))?;

    if response
        .content_length()
        .is_some_and(|length| length != asset.size)
    {
        return Err("The server's content length does not match the release metadata.".into());
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part_path)
        .map_err(|e| format!("Could not create temporary download file: {e}"))?;

    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];

    let download_result: Result<(), String> = (|| {
        loop {
            let count = response
                .read(&mut buffer)
                .map_err(|e| format!("Download interrupted: {e}"))?;

            if count == 0 {
                break;
            }

            total = total
                .checked_add(count as u64)
                .ok_or_else(|| "Downloaded size overflow.".to_string())?;

            if total > asset.size {
                return Err("Downloaded data exceeds the published asset size.".into());
            }

            file.write_all(&buffer[..count])
                .map_err(|e| format!("Could not write downloaded data: {e}"))?;

            hasher.update(&buffer[..count]);
        }

        file.flush()
            .map_err(|e| format!("Could not flush downloaded data: {e}"))?;

        if total != asset.size {
            return Err(format!(
                "Incomplete download: expected {} bytes, received {}.",
                asset.size, total
            ));
        }

        Ok(())
    })();

    if let Err(error) = download_result {
        drop(file);
        let _ = fs::remove_file(&part_path);
        return Err(error);
    }

    drop(file);

    let digest = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    let mut digest_verified = false;

    if let Some(expected_digest) = asset.digest.as_deref() {
        let expected = expected_digest
            .strip_prefix("sha256:")
            .ok_or_else(|| "Unsupported published digest format.".to_string())?;

        if !expected.eq_ignore_ascii_case(&digest) {
            let _ = fs::remove_file(&part_path);
            return Err("SHA-256 verification failed; the downloaded file was discarded.".into());
        }

        digest_verified = true;
    }

    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("Could not finalize downloaded file: {e}"))?;

    Ok(DownloadResult {
        name: asset_name,
        path: final_path.display().to_string(),
        bytes_written: total,
        sha256: digest,
        digest_verified,
    })
}


#[derive(Debug, Serialize)]
struct LocalAsset {
    name: String,
    version: String,
    path: String,
    size: u64,
    modified_at: Option<String>,
}

#[tauri::command]
fn list_downloaded_assets(app: tauri::AppHandle) -> Result<Vec<LocalAsset>, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not locate application data directory: {e}"))?;

    let downloads_dir = base_dir.join("downloads");

    if !downloads_dir.exists() {
        return Ok(Vec::new());
    }

    let mut assets = Vec::new();

    let versions = fs::read_dir(&downloads_dir)
        .map_err(|e| format!("Could not read downloads directory: {e}"))?;

    for version_entry in versions {
        let version_entry = version_entry
            .map_err(|e| format!("Could not read release directory: {e}"))?;

        let version_path = version_entry.path();

        if !version_path.is_dir() {
            continue;
        }

        let version = match version_path.file_name().and_then(|n| n.to_str()) {
            Some(value) => value.to_owned(),
            None => continue,
        };

        let files = fs::read_dir(&version_path)
            .map_err(|e| format!("Could not read release directory: {e}"))?;

        for file_entry in files {
            let file_entry = file_entry
                .map_err(|e| format!("Could not read downloaded file: {e}"))?;

            let path = file_entry.path();

            // Ignore temporary or incomplete downloads.
            if !path.is_file()
                || path.extension().and_then(|ext| ext.to_str()) == Some("part")
            {
                continue;
            }

            let metadata = fs::metadata(&path)
                .map_err(|e| format!("Could not inspect downloaded file: {e}"))?;

            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(value) => value.to_owned(),
                None => continue,
            };

            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs().to_string());

            assets.push(LocalAsset {
                name,
                version: version.clone(),
                path: path.display().to_string(),
                size: metadata.len(),
                modified_at,
            });
        }
    }

    assets.sort_by(|a, b| {
        b.version.cmp(&a.version).then_with(|| a.name.cmp(&b.name))
    });

    Ok(assets)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            latest_release,
            download_release_asset,
            list_downloaded_assets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
