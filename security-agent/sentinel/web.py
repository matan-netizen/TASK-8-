"""Black-box HTTP checks (no third-party dependencies).

Every check sends a small number of harmless requests: no payloads that
modify data, no brute force, no denial of service. Use only on systems you
own or are authorized to test.
"""
from __future__ import annotations

import re
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.client import HTTPResponse
from urllib.parse import urljoin, urlparse

from .findings import Finding

USER_AGENT = "Sentinel-SecurityAgent/1.0 (+authorized security scan)"
EVIL_ORIGIN = "https://evil.example"

SENSITIVE_PATHS = [
    "/.env", "/.env.local", "/.git/config", "/.git/HEAD", "/data/db.json", "/db.json",
    "/.DS_Store", "/server-status", "/backup.zip", "/.npmrc", "/config.json",
]
STACK_TRACE = re.compile(
    r"(Traceback \(most recent call last\)|at [\w.$<>]+ \(.*:\d+:\d+\)|node_modules/|"
    r"Exception in thread|SQLSTATE|\bstack\b\s*[:\"]|/home/\w+/|C:\\\\Users\\\\)",
    re.I,
)


@dataclass
class Resp:
    status: int
    headers: dict[str, str]
    cookies: list[str]
    body: str


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 - keep 3xx visible
        return None


class Http:
    """Tiny client: no redirects, polite delay, never raises on HTTP errors."""

    def __init__(self, base: str, delay: float = 0.1, timeout: float = 10.0, insecure_tls: bool = False):
        self.base = base.rstrip("/") + "/"
        self.delay = delay
        self.timeout = timeout
        ctx = ssl.create_default_context()
        if insecure_tls:  # only for self-signed lab targets, explicit opt-in
            ctx.check_hostname = False
            # Bandit: TLS verification is disabled only with the explicit --insecure flag.
            ctx.verify_mode = ssl.CERT_NONE  # nosec B501
        self.opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=ctx))
        self.requests = 0

    def url(self, path: str) -> str:
        return urljoin(self.base, path.lstrip("/"))

    def send(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None) -> Resp:
        time.sleep(self.delay)
        self.requests += 1
        h = {"User-Agent": USER_AGENT, **(headers or {})}
        req = urllib.request.Request(self.url(path), data=body, method=method, headers=h)  # noqa: S310
        try:
            # Bandit: the URL scheme is validated (http/https only) in agent.parse_args.
            r: HTTPResponse = self.opener.open(req, timeout=self.timeout)  # nosec B310
        except urllib.error.HTTPError as e:
            r = e  # type: ignore[assignment]
        with r:
            raw = r.read(200_000).decode("utf-8", "replace")
            hdrs = {k.lower(): v for k, v in r.headers.items()}
            return Resp(r.status, hdrs, r.headers.get_all("Set-Cookie") or [], raw)


def _short(s: str, n: int = 160) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n] + "…"


# ---------------------------------------------------------------- checks

def check_headers(http: Http) -> list[Finding]:
    r = http.send("GET", "/")
    h = r.headers
    out: list[Finding] = []
    https = http.base.startswith("https://")
    loc = http.url("/")

    def missing(check, title, sev, fix):
        out.append(Finding(check, title, "A02", sev, f"הכותרת חסרה בתשובה ל-GET / (HTTP {r.status})", fix, location=loc))

    csp = h.get("content-security-policy", "")
    if not csp:
        missing("web.headers.csp", "חסרה כותרת Content-Security-Policy", "medium",
                "להגדיר CSP מגביל (default-src 'self'; object-src 'none'; frame-ancestors 'none').")
    elif "unsafe-eval" in csp:
        out.append(Finding("web.headers.csp-weak", "ה-CSP מתיר 'unsafe-eval'", "A02", "low", _short(csp),
                           "להסיר 'unsafe-eval' בייצור.", location=loc))
    if not h.get("x-frame-options") and "frame-ancestors" not in csp:
        missing("web.headers.clickjacking", "אין הגנה מפני Clickjacking", "medium",
                "X-Frame-Options: DENY או frame-ancestors 'none' ב-CSP.")
    if h.get("x-content-type-options", "").lower() != "nosniff":
        missing("web.headers.nosniff", "חסרה X-Content-Type-Options: nosniff", "low",
                "להוסיף X-Content-Type-Options: nosniff.")
    if not h.get("referrer-policy"):
        missing("web.headers.referrer", "חסרה Referrer-Policy", "low",
                "להוסיף Referrer-Policy: strict-origin-when-cross-origin.")
    if https and not h.get("strict-transport-security"):
        missing("web.headers.hsts", "חסרה Strict-Transport-Security (HSTS)", "medium",
                "להוסיף Strict-Transport-Security: max-age=63072000; includeSubDomains.")
    for name in ("x-powered-by", "server", "x-aspnet-version"):
        v = h.get(name, "")
        if v and (name != "server" or re.search(r"\d", v)):
            out.append(Finding("web.disclosure." + name, f"חשיפת טכנולוגיה בכותרת {name}", "A02", "low",
                               f"{name}: {v}", "להסיר את הכותרת (ב-Next.js: poweredByHeader: false).", location=loc))
    return out


def check_transport(http: Http) -> list[Finding]:
    p = urlparse(http.base)
    if p.scheme == "http" and p.hostname not in ("localhost", "127.0.0.1", "::1"):
        return [Finding("web.tls.plain-http", "האתר נגיש ב-HTTP לא מוצפן", "A04", "high", http.base,
                        "להפנות את כל התעבורה ל-HTTPS ולהפעיל HSTS.", location=http.base)]
    return []


def check_cookies(http: Http, extra: list[Resp]) -> list[Finding]:
    """Inspect every Set-Cookie seen (home page + optional login probe)."""
    seen = list(extra) + [http.send("GET", "/")]
    out, done = [], set()
    https = http.base.startswith("https://")
    for r in seen:
        for c in r.cookies:
            name = c.split("=", 1)[0].strip()
            attrs = c.lower()
            if name in done:
                continue
            done.add(name)
            problems = []
            if "httponly" not in attrs:
                problems.append("HttpOnly")
            if https and "secure" not in attrs:
                problems.append("Secure")
            if "samesite" not in attrs or "samesite=none" in attrs:
                problems.append("SameSite")
            if problems:
                out.append(Finding("web.cookie.flags", f"לעוגייה {name} חסרים דגלים: {', '.join(problems)}", "A04",
                                   "medium", _short(c), "להגדיר HttpOnly; Secure; SameSite=Strict (או Lax).",
                                   location=http.base))
            value = c.split("=", 1)[1].split(";", 1)[0] if "=" in c else ""
            if value and len(value) < 16 and re.fullmatch(r"[\w-]+", value):
                out.append(Finding("web.cookie.predictable", f"ערך העוגייה {name} קצר וצפוי ('{value}'), ככל הנראה לא חתום",
                                   "A07", "high", _short(c),
                                   "לחתום את העוגייה (HMAC) או להשתמש במזהה סשן אקראי ארוך שנשמר בשרת.",
                                   location=http.base))
    return out


def check_sensitive_files(http: Http) -> list[Finding]:
    out = []
    for p in SENSITIVE_PATHS:
        r = http.send("GET", p)
        if r.status == 200 and r.body.strip() and "<html" not in r.body[:500].lower():
            out.append(Finding("web.exposed-file", f"קובץ רגיש נגיש: {p}", "A02", "high",
                               f"HTTP 200, {len(r.body)} bytes: {_short(r.body, 80)}",
                               "לחסום גישה לקובץ ולהסיר אותו מתיקיית הפרסום.", location=http.url(p)))
    return out


def check_cors(http: Http) -> list[Finding]:
    r = http.send("GET", "/", headers={"Origin": EVIL_ORIGIN})
    acao = r.headers.get("access-control-allow-origin", "")
    cred = r.headers.get("access-control-allow-credentials", "").lower() == "true"
    if acao == EVIL_ORIGIN or (acao == "*" and cred):
        return [Finding("web.cors.reflect", "CORS מאשר כל מקור (כולל עם עוגיות)", "A01", "high",
                        f"Access-Control-Allow-Origin: {acao}; credentials={cred}",
                        "לאשר רק רשימה סגורה של מקורות.", location=http.url("/"))]
    return []


def check_csrf(http: Http, paths: list[str], body: str) -> list[Finding]:
    out = []
    for p in paths:
        r = http.send("POST", p, body.encode(), {"Origin": EVIL_ORIGIN, "Content-Type": "application/json"})
        if 200 <= r.status < 300:
            out.append(Finding("web.csrf", f"בקשת POST מאתר זר התקבלה: {p}", "A01", "high",
                               f"Origin: {EVIL_ORIGIN} → HTTP {r.status}",
                               "לבדוק את הכותרת Origin/Referer בכל בקשה משנה, או להשתמש ב-CSRF token; SameSite=Strict.",
                               location=http.url(p)))
    return out


def check_forged_session(http: Http, path: str, cookie: str) -> list[Finding]:
    """Request a protected endpoint with a hand-crafted cookie."""
    anon = http.send("GET", path)
    forged = http.send("GET", path, headers={"Cookie": cookie})
    if 200 <= forged.status < 300 and not (200 <= anon.status < 300):
        return [Finding("web.auth.forged-cookie", "עוגייה מזויפת מעניקה גישה לנתיב מוגן", "A07", "critical",
                        f"ללא עוגייה: HTTP {anon.status}; עם '{cookie}': HTTP {forged.status} {_short(forged.body, 80)}",
                        "לא לסמוך על ערך עוגייה שהלקוח יכול לכתוב: לחתום אותה (HMAC) או לשמור סשן בצד השרת.",
                        location=http.url(path))]
    return []


def check_protected(http: Http, paths: list[str]) -> list[Finding]:
    out = []
    for p in paths:
        r = http.send("GET", p)
        if 200 <= r.status < 300:
            out.append(Finding("web.auth.unauthenticated", f"נתיב מוגן נגיש ללא התחברות: {p}", "A01", "high",
                               f"HTTP {r.status}: {_short(r.body, 80)}", "לדרוש הזדהות והרשאה בצד השרת.",
                               location=http.url(p)))
    return out


def check_error_handling(http: Http, paths: list[str]) -> list[Finding]:
    out = []
    for p in paths:
        r = http.send("POST", p, b'{"broken": ', {"Content-Type": "application/json"})
        if r.status >= 500 or STACK_TRACE.search(r.body):
            out.append(Finding("web.errors.leak", f"קלט פגום גורם לשגיאת שרת או לחשיפת פרטים: {p}", "A10",
                               "medium" if STACK_TRACE.search(r.body) else "low",
                               f"HTTP {r.status}: {_short(r.body, 120)}",
                               "לתפוס שגיאות, להחזיר 400 עם הודעה כללית, ולרשום את הפרטים רק ביומן השרת.",
                               location=http.url(p)))
    return out


def check_rate_limit(http: Http, path: str, body: str, attempts: int = 15) -> list[Finding]:
    statuses = []
    for _ in range(attempts):
        r = http.send("POST", path, body.encode(), {"Content-Type": "application/json"})
        statuses.append(r.status)
        if r.status == 429:
            return []
    return [Finding("web.ratelimit.missing", f"אין הגבלת קצב על {path}", "A06", "medium",
                    f"{attempts} בקשות ברצף, אף אחת לא נחסמה (סטטוסים: {sorted(set(statuses))})",
                    "להגביל ניסיונות לכל משתמש/IP ולהחזיר 429.", location=http.url(path))]


def login_probe(http: Http, path: str, body: str) -> Resp:
    return http.send("POST", path, body.encode(), {"Content-Type": "application/json",
                                                  "Origin": http.base.rstrip("/")})
