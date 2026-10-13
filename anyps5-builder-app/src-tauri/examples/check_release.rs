use serde::Deserialize;

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<Asset>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let release: Release = reqwest::blocking::Client::builder()
        .user_agent("AnyPS5-Builder")
        .build()?
        .get("https://api.github.com/repos/boykopovar/AnyPS5/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .send()?
        .error_for_status()?
        .json()?;

    println!("Latest stable release: {}", release.tag_name);
    println!("Published: {}", release.published_at.as_deref().unwrap_or("Unknown"));
    println!("Release page: {}", release.html_url);
    println!("\nOfficial assets:");

    for asset in release.assets {
        println!(
            "- {} ({:.1} MB)\n  {}",
            asset.name,
            asset.size as f64 / (1024.0 * 1024.0),
            asset.browser_download_url
        );
    }

    Ok(())
}
