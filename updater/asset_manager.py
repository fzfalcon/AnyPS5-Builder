#!/usr/bin/env python3
"""Download and verify assets from the official AnyPS5 GitHub release."""
import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

API = "https://api.github.com/repos/boykopovar/AnyPS5/releases/latest"
USER_AGENT = "AnyPS5-Builder/0.1"

def request(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.github+json",
        },
    )
    return urllib.request.urlopen(req, timeout=60)

def latest_release():
    with request(API) as response:
        return json.load(response)

def download_asset(asset, destination):
    url = asset["browser_download_url"]
    expected = (asset.get("digest") or "").removeprefix("sha256:")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    temp = destination.with_suffix(destination.suffix + ".part")
    digest = hashlib.sha256()
    try:
        with request(url) as response, temp.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                digest.update(chunk)

        actual = digest.hexdigest()
        if expected and actual.lower() != expected.lower():
            raise ValueError(
                f"SHA-256 mismatch: expected {expected}, got {actual}"
            )
        os.replace(temp, destination)
        print(f"Downloaded and verified: {destination}")
        print(f"SHA-256: {actual}")
    finally:
        if temp.exists():
            temp.unlink()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true",
                        help="List assets in the latest official release")
    parser.add_argument("--download", metavar="ASSET",
                        help="Exact asset filename to download")
    parser.add_argument("--out", default="downloads",
                        help="Output directory (default: downloads)")
    args = parser.parse_args()

    try:
        release = latest_release()
        print(f"Official release: {release['tag_name']}")
        assets = release.get("assets", [])

        if args.list or not args.download:
            for asset in assets:
                print(f"{asset['name']} ({asset['size']:,} bytes)")
            if not args.download:
                return

        selected = next(
            (a for a in assets if a["name"] == args.download), None
        )
        if selected is None:
            raise ValueError(
                f"Asset {args.download!r} is not in the latest release."
            )

        target = Path(args.out) / release["tag_name"] / selected["name"]
        download_asset(selected, target)

    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
