#!/usr/bin/env python3
"""Read-only checker for official AnyPS5 release and main-branch metadata."""
import json
import urllib.request
from datetime import datetime, timezone

API = "https://api.github.com"
REPO = "boykopovar/AnyPS5"

def get_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "AnyPS5-Builder-upstream-checker",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

def main():
    release = get_json(f"{API}/repos/{REPO}/releases/latest")
    branch = get_json(f"{API}/repos/{REPO}/commits/main")
    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "upstream": f"https://github.com/{REPO}",
        "latest_release": {
            "tag": release.get("tag_name"),
            "name": release.get("name"),
            "published_at": release.get("published_at"),
            "html_url": release.get("html_url"),
            "assets": [
                {
                    "name": asset.get("name"),
                    "size": asset.get("size"),
                    "download_url": asset.get("browser_download_url"),
                    "digest": asset.get("digest"),
                }
                for asset in release.get("assets", [])
            ],
        },
        "main_branch": {
            "sha": branch.get("sha"),
            "url": branch.get("html_url"),
            "committed_at": branch.get("commit", {}).get("committer", {}).get("date"),
        },
    }
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
