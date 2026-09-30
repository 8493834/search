import json
import math
import os
import shutil
from collections import Counter
from datetime import datetime, timezone

from textproc import STOPWORDS, analyze, shard_of

DOCS_PER_CHUNK = 100
TITLE_WEIGHT = 5
DESC_WEIGHT = 2
SNIPPET_CHARS = 1800


def pagerank(n, edges, damping=0.85, iters=30):
    if n == 0:
        return []
    out = [[] for _ in range(n)]
    for s, d in edges:
        if s != d:
            out[s].append(d)
    rank = [1.0 / n] * n
    for _ in range(iters):
        new = [(1.0 - damping) / n] * n
        sink = 0.0
        for i in range(n):
            if out[i]:
                share = damping * rank[i] / len(out[i])
                for d in set(out[i]):
                    new[d] += share
            else:
                sink += damping * rank[i]
        for i in range(n):
            new[i] += sink / n
        rank = new
    top = max(rank) or 1.0
    return [round(r / top, 4) for r in rank]


def build_index(pages, out_dir):
    n = len(pages)
    url_to_id = {p["url"]: i for i, p in enumerate(pages)}

    postings = {}  # term -> list of (doc_id, weighted_tf)
    doc_len = []
    edges = []
    for doc_id, p in enumerate(pages):
        tf = Counter()
        for t in analyze(p["title"]):
            tf[t] += TITLE_WEIGHT
        for t in analyze(p["description"]):
            tf[t] += DESC_WEIGHT
        for t in analyze(p["text"]):
            tf[t] += 1
        doc_len.append(sum(tf.values()))
        for term, count in tf.items():
            postings.setdefault(term, []).append((doc_id, count))
        for link in set(p["links"]):
            if link in url_to_id:
                edges.append((doc_id, url_to_id[link]))

    total_postings = sum(len(v) for v in postings.values())
    n_shards = max(1, min(512, math.ceil(total_postings / 15000)))

    shards = [dict() for _ in range(n_shards)]
    for term, plist in postings.items():
        flat = []
        for doc_id, count in plist:
            flat += [doc_id, count]
        shards[shard_of(term, n_shards)][term] = flat

    data_dir = out_dir
    if os.path.isdir(data_dir):
        shutil.rmtree(data_dir)
    os.makedirs(data_dir)

    def dump(name, obj):
        with open(os.path.join(data_dir, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    for i, shard in enumerate(shards):
        dump(f"s{i}.json", shard)

    n_chunks = math.ceil(n / DOCS_PER_CHUNK)
    for c in range(n_chunks):
        chunk = pages[c * DOCS_PER_CHUNK : (c + 1) * DOCS_PER_CHUNK]
        dump(f"d{c}.json", [[p["url"], p["title"], p["description"], p["text"][:SNIPPET_CHARS]] for p in chunk])

    site_counts = Counter(p["site"] for p in pages)
    dump(
        "meta.json",
        {
            "version": 1,
            "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "numDocs": n,
            "numSites": len(site_counts),
            "siteCounts": dict(site_counts),
            "avgdl": round(sum(doc_len) / n, 3) if n else 0,
            "shards": n_shards,
            "chunk": DOCS_PER_CHUNK,
            "k1": 1.2,
            "b": 0.75,
            "stopwords": STOPWORDS,
            "dl": doc_len,
            "pr": pagerank(n, edges),
        },
    )
    return {"docs": n, "terms": len(postings), "shards": n_shards, "sites": len(site_counts)}
