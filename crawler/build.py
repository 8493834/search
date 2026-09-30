import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from crawl import crawl_all  # noqa: E402
from indexer import build_index  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_json(name, default=None):
    path = os.path.join(ROOT, name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def firestore_sites(project_id):
    """Read the public `sites` collection through Firestore's REST API (no login needed)."""
    urls, token = [], None
    while True:
        q = {"pageSize": "300"}
        if token:
            q["pageToken"] = token
        endpoint = (
            f"https://firestore.googleapis.com/v1/projects/{project_id}"
            f"/databases/(default)/documents/sites?{urllib.parse.urlencode(q)}"
        )
        with urllib.request.urlopen(endpoint, timeout=30) as r:
            data = json.load(r)
        for doc in data.get("documents", []):
            url = doc.get("fields", {}).get("url", {}).get("stringValue")
            if url:
                urls.append(url)
        token = data.get("nextPageToken")
        if not token:
            return urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds-only", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "data"))
    args = ap.parse_args()

    cfg = load_json("config.json")
    seeds = list(load_json("seeds.json", []))
    project = cfg.get("firebaseProjectId", "")

    if not args.seeds_only and project and not project.startswith("YOUR_"):
        print(f"Reading approved sites from Firebase project '{project}' ...")
        approved = firestore_sites(project)  # if this fails we stop, so we never wipe the index
        print(f"  {len(approved)} approved site(s)")
        seeds += approved
    else:
        print("Firebase not configured (or --seeds-only): using seeds.json only.")

    if not seeds:
        print("No sites to crawl. Add some to seeds.json or approve requests. Index left unchanged.")
        return 0

    print(f"Crawling {len(seeds)} site(s) ...")
    pages = crawl_all(seeds, cfg)
    if not pages:
        print("Crawl produced 0 pages. Index left unchanged.")
        return 1

    stats = build_index(pages, args.out)
    print(f"Done: {stats['docs']} pages, {stats['terms']} terms, {stats['shards']} shards, {stats['sites']} sites.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
