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

    def __init__(self, seed_url, cfg, deadline):
        self.seed = normalize_url(seed_url)
        self.key = site_key(self.seed)
        self.cfg = cfg
        self.deadline = deadline
        self.robots = None
        self.delay = cfg["crawlDelaySeconds"]

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
        queue = deque([self.seed])
        seen = {self.seed}
        final_seen = set()
        pages, errors = [], 0
        while queue and len(pages) < self.cfg["maxPagesPerSite"] and time.time() < self.deadline:
            url = queue.popleft()
            if not self.robots.can_fetch(self.cfg["userAgent"], url):
                continue
            try:
                final, html = self._get(url)
            except Exception:
                errors += 1
                if errors > 25 and not pages:
                    break  # site looks dead
                time.sleep(self.delay)
                continue
            time.sleep(self.delay)
            final_norm = normalize_url(final)
            if html is None or not final_norm or site_key(final_norm) != self.key or final_norm in final_seen:
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
                if not link or site_key(link) != self.key or SKIP_EXT.search(urlparse(link).path):
                    continue
                out_links.append(link)
                if link not in seen:
                    seen.add(link)
                    queue.append(link)
            if parser.noindex or len(parser.text) < 40:
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
    from concurrent.futures import ThreadPoolExecutor

    deadline = time.time() + cfg["totalTimeBudgetMinutes"] * 60
    seeds, keys = [], set()
    for u in seed_urls:
        n = normalize_url(u)
        if n and site_key(n) not in keys:
            keys.add(site_key(n))
            seeds.append(n)

    def work(seed):
        try:
            pages = Site(seed, cfg, deadline).crawl()
        except Exception as e:  # never let one site kill the run
            log(f"  ! {seed}: {e}")
            pages = []
        log(f"  {site_key(seed)}: {len(pages)} pages")
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
