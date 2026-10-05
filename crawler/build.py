import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from crawl import crawl_all, scope_key, site_key  # noqa: E402
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
    entries, token = [], None
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
            f = doc.get("fields", {})
            url = f.get("url", {}).get("stringValue")
            if url:
                entries.append({"url": url, "description": f.get("description", {}).get("stringValue", "")})
        token = data.get("nextPageToken")
        if not token:
            return entries


def add_listings(entries, pages):
    """Sites that are not crawled (listed on purpose, or a plain-HTML crawler can't read them:
    JavaScript apps, login walls, bot blocking) get one searchable listing built from the name and
    description they were added with. Entries earlier in the list win, so put approved sites first."""
    present = {p["site"] for p in pages}
    best = {}
    for e in entries:
        key = scope_key(e["url"])
        if key in present:
            continue
        cur = best.setdefault(key, {"url": e["url"], "name": "", "description": ""})
        cur["name"] = cur["name"] or (e.get("name") or "").strip()
        cur["description"] = cur["description"] or (e.get("description") or "").strip()
    for key, e in best.items():
        desc = e["description"]
        pages.append({
            "url": e["url"], "title": e["name"] or site_key(e["url"]), "description": desc[:300],
            "text": desc, "links": [], "site": key,
        })
    return list(best)


def load_seeds():
    """seeds.json entries are an address, or {"url", "name", "description", "crawl": false}."""
    out = []
    for item in load_json("seeds.json", []):
        if isinstance(item, str):
            item = {"url": item}
        if item.get("url"):
            out.append({"url": item["url"], "name": item.get("name", ""),
                        "description": item.get("description", ""), "crawl": item.get("crawl", True)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds-only", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "data"))
    args = ap.parse_args()

    cfg = load_json("config.json")
    seeds = load_seeds()
    entries = []
    project = cfg.get("firebaseProjectId", "")

    if not args.seeds_only and project and not project.startswith("YOUR_"):
        print(f"Reading approved sites from Firebase project '{project}' ...")
        approved = firestore_sites(project)  # if this fails we stop, so we never wipe the index
        print(f"  {len(approved)} approved site(s)")
        entries += approved  # approved sites come first so their own descriptions win
    else:
        print("Firebase not configured (or --seeds-only): using seeds.json only.")

    entries += seeds
    if not entries:
        print("No sites to crawl. Add some to seeds.json or approve requests. Index left unchanged.")
        return 0

    to_crawl = [e["url"] for e in entries if e.get("crawl", True)]
    print(f"Crawling {len(to_crawl)} site(s), {len(entries) - len(to_crawl)} listed without crawling ...")
    pages = crawl_all(to_crawl, cfg)
    listed = add_listings(entries, pages)
    if listed:
        print(f"  Listing only: {len(listed)} site(s)")
    if not pages:
        print("Crawl produced 0 pages. Index left unchanged.")
        return 1

    stats = build_index(pages, args.out)
    print(f"Done: {stats['docs']} pages, {stats['terms']} terms, {stats['shards']} shards, {stats['sites']} sites.")
    return 0


if __name__ == "__main__":
    sys.exit(main())