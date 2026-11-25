"""Wrappers around external scanners. Each one is optional: if the tool is
not installed the agent records that it was skipped and continues."""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
# Bandit: subprocess runs fixed argv lists only, never shell=True.
import subprocess  # nosec B404
import tempfile
from pathlib import Path
from urllib.parse import urljoin

from .findings import Finding

TOOL_TIMEOUT = 600


def _run(argv: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=TOOL_TIMEOUT, check=False)  # nosec B603


# ------------------------------------------------------------------ nikto

def nikto(url: str) -> tuple[list[Finding], str]:
    exe = shutil.which("nikto") or shutil.which("nikto.pl")
    if not exe:
        return [], "skipped: nikto not installed (apt install nikto)"
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "nikto.csv")
        # CSV is supported by every Nikto version (JSON only from 2.5).
        p = _run([exe, "-h", url, "-Format", "csv", "-output", out, "-ask", "no", "-maxtime", "300s"])
        try:
            text = Path(out).read_text("utf-8", "replace")
        except OSError:
            tail = " ".join((p.stderr or p.stdout).split())[-160:]
            return [], f"error: nikto produced no output ({tail})"
    findings = []
    for row in csv.reader(text.splitlines()):
        # host, ip, port, id/references, method, uri, message
        if len(row) < 7 or row[0].lower() in ("host", "hostname") or not row[-1].strip():
            continue
        ref, uri, msg = row[3].strip(), row[5].strip(), row[-1].strip()
        findings.append(Finding(
            f"nikto.{ref or '0'}.{uri}", f"Nikto: {msg[:120]}", _nikto_owasp(msg),
            "medium" if "OSVDB" in ref or "CVE" in msg else "low",
            msg[:300], "לבדוק את הממצא ולתקן לפי ההמלצה של Nikto.", source="nikto",
            location=urljoin(url, uri) if uri else url))
    return findings, f"ok: {len(findings)} findings"


def _nikto_owasp(msg: str) -> str:
    m = msg.lower()
    if "header" in m or "x-frame" in m or "directory indexing" in m or "default file" in m:
        return "A02"
    if "cookie" in m:
        return "A04"
    if "outdated" in m or "version" in m:
        return "A03"
    if "injection" in m or "xss" in m:
        return "A05"
    return "A02"


# ----------------------------------------------------------------- bandit

BANDIT_OWASP = {  # Bandit test id -> OWASP 2025
    "B105": "A07", "B106": "A07", "B107": "A07",                 # hard-coded passwords
    "B303": "A04", "B304": "A04", "B305": "A04", "B324": "A04",  # weak crypto / hashes
    "B501": "A04", "B502": "A04", "B503": "A04", "B504": "A04",  # TLS
    "B506": "A08", "B301": "A08", "B302": "A08", "B403": "A08",  # unsafe deserialization
    "B201": "A02", "B104": "A02",                                # debug, bind all interfaces
    "B110": "A10", "B112": "A10",                                # try/except/pass|continue
}


def bandit(src: str) -> tuple[list[Finding], str]:
    exe = shutil.which("bandit")
    if not exe:
        return [], "skipped: bandit not installed (pip install bandit)"
    if not any(Path(src).rglob("*.py")):
        return [], "skipped: no Python files"
    p = _run([exe, "-r", src, "-f", "json", "-q", "-x", ",".join(_excluded(src))])
    try:
        data = json.loads(p.stdout or "{}")
    except ValueError:
        return [], f"error: {p.stderr[:200]}"
    findings = []
    for r in data.get("results", []):
        tid = r["test_id"]
        owasp = BANDIT_OWASP.get(tid, "A05" if tid.startswith(("B6", "B7")) else "A02")
        sev = {"LOW": "low", "MEDIUM": "medium", "HIGH": "high"}[r["issue_severity"]]
        rel = os.path.relpath(r["filename"], src)
        findings.append(Finding(
            f"bandit.{tid}", f"Bandit {tid}: {r['issue_text'][:110]}", owasp, sev,
            r.get("code", "").strip()[:200], f"ראו {r.get('more_info', '')}", source="bandit",
            location=f"{rel}:{r['line_number']}"))
    return findings, f"ok: {len(findings)} findings"


def _excluded(src: str) -> list[str]:
    return [str(Path(src) / d) for d in ("node_modules", ".venv", "venv", ".git", "tests")]


# -------------------------------------------------------------- npm audit

def npm_audit(src: str) -> tuple[list[Finding], str]:
    if not (Path(src) / "package-lock.json").exists():
        return [], "skipped: no package-lock.json"
    exe = shutil.which("npm")
    if not exe:
        return [], "skipped: npm not installed"
    p = _run([exe, "audit", "--json", "--omit=dev"], cwd=src)
    try:
        data = json.loads(p.stdout or "{}")
    except ValueError:
        return [], "error: npm audit returned invalid JSON"
    findings = []
    for name, v in (data.get("vulnerabilities") or {}).items():
        sev = {"moderate": "medium"}.get(v.get("severity"), v.get("severity", "low"))
        via = [x.get("title", "") for x in v.get("via", []) if isinstance(x, dict)]
        findings.append(Finding(
            f"npm.{name}", f"ספרייה פגיעה: {name} ({v.get('range', '')})", "A03", sev,
            "; ".join(via)[:200] or f"דרך {', '.join(str(x) for x in v.get('via', []))}",
            "לעדכן את הספרייה, או להגדיר overrides לגרסה מתוקנת.", source="npm-audit",
            location="package-lock.json"))
    return findings, f"ok: {len(findings)} findings"


# ---------------------------------------------------------------- secrets

SECRET_PATTERNS = {
    "Anthropic API key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "OpenAI API key": re.compile(r"sk-(proj-)?[A-Za-z0-9]{32,}"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"),
    "Private key": re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
SKIP_DIRS = {"node_modules", ".git", ".next", "venv", ".venv", "__pycache__", "dist", "build"}
TEXT_EXT = {".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".env", ".yml", ".yaml", ".md", ".txt", ".toml", ".ini", ".sh"}


def secrets(src: str) -> tuple[list[Finding], str]:
    findings, scanned = [], 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            path = Path(root) / f
            if path.suffix not in TEXT_EXT and not f.startswith(".env"):
                continue
            try:
                text = path.read_text("utf-8", "ignore")
            except OSError:
                continue
            scanned += 1
            for label, rx in SECRET_PATTERNS.items():
                for m in rx.finditer(text):
                    line = text.count("\n", 0, m.start()) + 1
                    masked = m.group(0)[:8] + "…" + m.group(0)[-4:]
                    findings.append(Finding(
                        "secrets." + label.lower().replace(" ", "-"), f"סוד בקוד: {label}", "A04", "critical",
                        masked, "להחליף (rotate) את המפתח מיד ולהעביר אותו למשתנה סביבה.", source="secrets",
                        location=f"{os.path.relpath(path, src)}:{line}"))
    return findings, f"ok: {scanned} files scanned"
