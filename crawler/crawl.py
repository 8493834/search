"""A small, polite web crawler using only the Python standard library."""
import hashlib
import re
import time
import urllib.error
import urllib.request
import urllib.robotparser
from collections import defaultdict, deque
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

SKIP_EXT = re.compile(
    r"\.(jpe?g|png|gif|webp|svg|ico|bmp|pdf|zip|gz|tar|rar|7z|mp3|mp4|avi|mov|webm|"
    r"wav|ogg|exe|dmg|iso|apk|css|js|json|xml|rss|atom|woff2?|ttf|eot|docx?|xlsx?|pptx?)$",
    re.I,
)
TRACKING = re.compile(r"^(utm_.*|fbclid|gclid|mc_.*|ref|ref_src)$", re.I)
SKIP_TEXT_TAGS = {"script", "style", "noscript", "template", "svg", "nav", "footer", "aside", "head"}
BLOCK_TAGS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "pre", "blockquote"}


def normalize_url(url):
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    host = p.hostname.lower() if p.hostname else ""
    port = f":{p.port}" if p.port and p.port not in (80, 443) else ""
    query = urlencode([(k, v) for k, v in parse_qsl(p.query) if not TRACKING.match(k)])
    path = p.path or "/"
    return urlunparse((p.scheme, host + port, path, "", query, ""))


def site_key(url):
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def scope_of(url):
    """A site's scope is its host plus the folder of the address given.
    https://me.github.io/sps/index.html -> (me.github.io, /sps/)   https://me.github.io/ -> (me.github.io, /)"""
    path = urlparse(url).path or "/"
    if path.endswith("/"):
        prefix = path
    elif "." in path.rsplit("/", 1)[-1]:
        prefix = path[: path.rfind("/") + 1]
    else:
        prefix = path + "/"
    return site_key(url), prefix


def scope_key(url):
    host, prefix = scope_of(url)
    return host if prefix == "/" else host + prefix.rstrip("/")


_QUOTED = re.compile(r"""['"]([^'"\s]+)['"]""")
_URLISH = re.compile(r"^(https?://\S+|\.{0,2}/\S+|[\w\-./]+\.html?(\?\S*)?)$", re.I)


def urls_in_handler(code):
    """Finds addresses inside inline JS like onclick="window.open('https://x/y.html')"."""
    return [m for m in _QUOTED.findall(code or "") if _URLISH.match(m)]


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.description = "", ""
        self.noindex = False
        self.base = None
        self.links = []
        self._text = []
        self._skip = defaultdict(int)
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "base" and a.get("href") and not self.base:
            self.base = a["href"]
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or "").lower()
            content = a.get("content") or ""
            if name in ("description", "og:description") and not self.description:
                self.description = content.strip()
            elif name == "robots" and "noindex" in content.lower():
                self.noindex = True
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        for attr in ("onclick", "data-href", "data-url"):
            if a.get(attr):
                self.links.extend(urls_in_handler(a[attr]))
        if tag in SKIP_TEXT_TAGS:
            self._skip[tag] += 1
        if tag in BLOCK_TAGS:
            self._text.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in SKIP_TEXT_TAGS and self._skip[tag] > 0:
            self._skip[tag] -= 1
        if tag in BLOCK_TAGS:
            self._text.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not any(self._skip.values()):
            self._text.append(data)

    @property
    def text(self):
        return re.sub(r"\s+", " ", " ".join(self._text)).strip()


class Site:
    """Crawls one site (same host only), breadth first."""

    def __init__(self, seed_urls, cfg, deadline):
        if isinstance(seed_urls, str):
            seed_urls = [seed_urls]
        self.starts = [n for n in (normalize_url(u) for u in seed_urls) if n]
        self.seed = self.starts[0]
        self.host, self.prefix = scope_of(self.seed)
        self.key = scope_key(self.seed)
        self.stats = defaultdict(int)
        self.cfg = cfg
        self.deadline = deadline
        self.site_deadline = time.time() + cfg.get("maxMinutesPerSite", 6) * 60
        self.robots = None
        self.delay = cfg["crawlDelaySeconds"]

    def in_scope(self, url):
        return site_key(url) == self.host and (urlparse(url).path or "/").startswith(self.prefix)

    def _get(self, url, want_html=True):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.cfg["userAgent"],
                "Accept": "text/html,application/xhtml+xml" if want_html else "*/*",
                "Accept-Encoding": "identity",
            },
        )
        with urllib.request.urlopen(req, timeout=self.cfg["timeoutSeconds"]) as r:
            ctype = r.headers.get("Content-Type", "")
            if want_html and "html" not in ctype.lower():
                return r.geturl(), None
            raw = r.read(self.cfg["maxPageBytes"])
            enc = "utf-8"
            m = re.search(r"charset=([\w-]+)", ctype, re.I)
            if m:
                enc = m.group(1)
            else:
                mb = re.search(rb"charset=[\"']?([\w-]+)", raw[:2048], re.I)
                if mb:
                    enc = mb.group(1).decode("ascii", "ignore")
            try:
                return r.geturl(), raw.decode(enc, errors="replace")
            except LookupError:
                return r.geturl(), raw.decode("utf-8", errors="replace")

    def _load_robots(self):
        rp = urllib.robotparser.RobotFileParser()
        base = urlparse(self.seed)
        try:
            _, body = self._get(f"{base.scheme}://{base.netloc}/robots.txt", want_html=False)
            rp.parse((body or "").splitlines())
        except urllib.error.HTTPError as e:
            if e.code >= 500:
                rp.disallow_all = True  # server is broken: be safe, skip it
            else:
                rp.parse([])  # 4xx: no robots.txt, everything allowed
        except Exception:
            rp.parse([])
        self.robots = rp
        cd = rp.crawl_delay(self.cfg["userAgent"]) or rp.crawl_delay("*")
        if cd:
            self.delay = min(max(self.delay, float(cd)), 10.0)

    def crawl(self):
        self._load_robots()
        queue = deque(self.starts)
        seen = set(self.starts)
        final_seen = set()
        pages, in_a_row = [], 0
        stop_at = min(self.deadline, self.site_deadline)
        while queue and len(pages) < self.cfg["maxPagesPerSite"]:
            if time.time() >= stop_at:
                self.stats["stopped at the time limit"] += 1
                break
            url = queue.popleft()
            if not self.robots.can_fetch(self.cfg["userAgent"], url):
                self.stats["blocked by robots.txt"] += 1
                continue
            try:
                final, html = self._get(url)
            except Exception:
                in_a_row += 1
                self.stats["fetch errors"] += 1
                if in_a_row >= 3 and not pages:
                    break  # site is blocking us or is down: don't waste time on it
                time.sleep(self.delay)
                continue
            in_a_row = 0
            time.sleep(self.delay)
            final_norm = normalize_url(final)
            if html is None:
                self.stats["not html"] += 1
                continue
            if not final_norm or not self.in_scope(final_norm) or final_norm in final_seen:
                self.stats["redirected out of scope or duplicate"] += 1
                continue
            final_seen.add(final_norm)
            parser = PageParser()
            try:
                parser.feed(html)
            except Exception:
                pass
            base = urljoin(final, parser.base) if parser.base else final
            out_links = []
            for href in parser.links:
                link = normalize_url(urljoin(base, href.strip()))
                if not link or not self.in_scope(link) or SKIP_EXT.search(urlparse(link).path):
                    continue
                out_links.append(link)
                if link not in seen:
                    seen.add(link)
                    queue.append(link)
            if parser.noindex:
                self.stats["noindex"] += 1
                continue
            if not (parser.text or parser.title.strip() or parser.description):
                self.stats["empty page (content probably built by JavaScript)"] += 1
                continue
            title = re.sub(r"\s+", " ", parser.title).strip() or urlparse(final_norm).path or final_norm
            pages.append(
                {
                    "url": final_norm,
                    "title": title[:200],
                    "description": re.sub(r"\s+", " ", parser.description)[:300],
                    "text": parser.text[: self.cfg["maxTextChars"]],
                    "links": out_links,
                    "site": self.key,
                }
            )
        return pages


def crawl_all(seed_urls, cfg, log=print):
    """Crawl every seed (in parallel across different sites) and return all pages."""
    from concurrent.futures import ThreadPoolExecutor

    deadline = time.time() + cfg["totalTimeBudgetMinutes"] * 60
    groups = {}  # scope -> every address given for that scope
    for u in seed_urls:
        n = normalize_url(u)
        if n:
            groups.setdefault(scope_key(n), []).append(n)
    seeds = list(groups.values())

    def work(seed):
        site = Site(seed, cfg, deadline)
        try:
            pages = site.crawl()
        except Exception as e:  # never let one site kill the run
            log(f"  ! {seed}: {e}")
            pages = []
        why = ", ".join(f"{v} {k}" for k, v in site.stats.items())
        log(f"  {site.key}: {len(pages)} pages" + (f"  (skipped: {why})" if why else ""))
        return pages

    with ThreadPoolExecutor(max_workers=cfg["parallelSites"]) as ex:
        results = list(ex.map(work, seeds))

    pages, seen_urls, seen_hash = [], set(), set()
    for group in results:
        for p in group:
            h = hashlib.sha1(p["text"].encode("utf-8")).hexdigest()
            if p["url"] in seen_urls or h in seen_hash:
                continue
            seen_urls.add(p["url"])
            seen_hash.add(h)
            pages.append(p)
    return pages
