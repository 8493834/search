"""Text processing shared by the indexer.

IMPORTANT: docs/js/engine.js contains a line-for-line port of tokenize(),
stem() and shard_of(). If you change anything here, change it there too,
or queries will stop matching the index.
"""
import re

TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)  # letters + digits, any language

STOPWORDS = sorted(
    "a an and are as at be but by for if in into is it no not of on or such "
    "that the their then there these they this to was will with".split()
)

_VOWEL_RE = re.compile(r"[aeiouy]")


def tokenize(text):
    return [t for t in TOKEN_RE.findall(text.lower()) if len(t) <= 40]


def _undouble(w):
    if len(w) > 3 and w[-1] == w[-2] and w[-1] not in "lsz":
        return w[:-1]
    return w


def stem(w):
    """A small, deliberately simple suffix stripper (not full Porter)."""
    n = len(w)
    if n > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif n > 4 and w.endswith("sses"):
        w = w[:-2]
    elif n > 5 and w.endswith("ing") and _VOWEL_RE.search(w[:-3]):
        w = _undouble(w[:-3])
    elif n > 4 and w.endswith("ed") and _VOWEL_RE.search(w[:-2]):
        w = _undouble(w[:-2])
    elif n > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        w = w[:-1]
    if len(w) > 3 and w.endswith("e"):
        w = w[:-1]
    return w


def analyze(text):
    """text -> list of stemmed, non-stopword terms."""
    stop = set(STOPWORDS)
    return [stem(t) for t in tokenize(text) if t not in stop]


def shard_of(term, n_shards):
    """FNV-1a 32-bit hash of the UTF-8 bytes, modulo the shard count."""
    h = 2166136261
    for b in term.encode("utf-8"):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h % n_shards
