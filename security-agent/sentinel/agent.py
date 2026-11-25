"""Sentinel: a security agent that plans, scans, triages and reports.

    plan  -> decide which modules apply to the inputs (URL / source dir)
    scan  -> built-in HTTP checks + Nikto + Bandit + npm audit + secrets
    triage-> de-duplicate, sort by severity, optional Claude analysis
    report-> Markdown + JSON, exit code for CI gates
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import urlparse

from . import ai, report, tools, web
from .findings import Finding, severity_rank

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="sentinel", description="Security agent: OWASP Top 10:2025 scanner")
    p.add_argument("--url", help="target base URL, e.g. https://app.example.com")
    p.add_argument("--src", help="source directory for static analysis")
    p.add_argument("--authorized", action="store_true",
                   help="confirm you own or are authorized to test a non-local target")
    p.add_argument("--login-path", help="POST endpoint that sets a session cookie (cookie flags + rate limit)")
    p.add_argument("--login-body", default="{}", help="JSON body for --login-path")
    p.add_argument("--csrf-path", action="append", default=[], help="state-changing endpoint to probe for CSRF")
    p.add_argument("--protected", action="append", default=[], help="path that must require login")
    p.add_argument("--forged-cookie", help="'name=value' cookie to try against the first --protected path")
    p.add_argument("--error-path", action="append", default=[], help="JSON endpoint to send malformed input to")
    p.add_argument("--no-nikto", action="store_true")
    p.add_argument("--no-ai", action="store_true")
    p.add_argument("--insecure", action="store_true", help="accept self-signed TLS (lab only)")
    p.add_argument("--out", default="reports/sentinel", help="report path prefix (.md and .json are added)")
    p.add_argument("--fail-on", choices=["low", "medium", "high", "critical", "never"], default="high",
                   help="exit 1 if a finding at this severity or above exists (CI gate)")
    a = p.parse_args(argv)
    if not a.url and not a.src:
        p.error("give --url and/or --src")
    if a.url:
        u = urlparse(a.url)
        if u.scheme not in ("http", "https") or not u.hostname:
            p.error("--url must be http(s)://host")
        if u.hostname not in LOCAL_HOSTS and not a.authorized:
            p.error("scanning a remote host requires --authorized (only scan systems you own or may test)")
    if a.src and not Path(a.src).is_dir():
        p.error(f"--src {a.src} is not a directory")
    return a


def plan(a: argparse.Namespace) -> list[str]:
    steps = []
    if a.url:
        steps += ["transport", "headers", "sensitive-files", "cors"]
        if a.login_path:
            steps += ["cookies", "rate-limit"]
        if a.csrf_path:
            steps.append("csrf")
        if a.protected:
            steps.append("protected")
        if a.forged_cookie and a.protected:
            steps.append("forged-session")
        if a.error_path:
            steps.append("error-handling")
        if not a.no_nikto:
            steps.append("nikto")
    if a.src:
        steps += ["bandit", "npm-audit", "secrets"]
    if not a.no_ai:
        steps.append("ai-triage")
    return steps


def run(a: argparse.Namespace, log=print) -> tuple[dict, list[dict], str | None]:
    steps = plan(a)
    log(f"[plan] {' → '.join(steps)}")
    found: list[Finding] = []
    status: dict[str, str] = {}

    def step(name, fn):
        if name not in steps:
            return
        try:
            res = fn()
            if isinstance(res, tuple):
                res, msg = res
            else:
                msg = f"ok: {len(res)} findings"
            found.extend(res)
            status[name] = msg
        except Exception as e:  # one failing module must not stop the scan
            status[name] = f"error: {type(e).__name__}: {e}"
        log(f"[{name}] {status[name]}")

    if a.url:
        http = web.Http(a.url, insecure_tls=a.insecure)
        login_resps = []
        if a.login_path:
            login_resps.append(web.login_probe(http, a.login_path, a.login_body))
        step("transport", lambda: web.check_transport(http))
        step("headers", lambda: web.check_headers(http))
        step("cookies", lambda: web.check_cookies(http, login_resps))
        step("sensitive-files", lambda: web.check_sensitive_files(http))
        step("cors", lambda: web.check_cors(http))
        step("csrf", lambda: web.check_csrf(http, a.csrf_path, a.login_body))
        step("protected", lambda: web.check_protected(http, a.protected))
        step("forged-session", lambda: web.check_forged_session(http, a.protected[0], a.forged_cookie))
        step("error-handling", lambda: web.check_error_handling(http, a.error_path))
        step("rate-limit", lambda: web.check_rate_limit(http, a.login_path, a.login_body))
        step("nikto", lambda: tools.nikto(a.url))
        status["http-requests"] = str(http.requests)
    if a.src:
        step("bandit", lambda: tools.bandit(a.src))
        step("npm-audit", lambda: tools.npm_audit(a.src))
        step("secrets", lambda: tools.secrets(a.src))

    # triage: de-duplicate (same check + location) and sort by severity
    uniq = {(f.check, f.location): f for f in found}
    findings = sorted((f.to_dict() for f in uniq.values()),
                      key=lambda f: (-severity_rank(f["severity"]), f["owasp"], f["check"]))

    ai_text = None
    if "ai-triage" in steps:
        ai_text, status["ai-triage"] = ai.triage(findings, a.url or a.src)
        log(f"[ai-triage] {status['ai-triage']}")

    meta = {"target": a.url, "src": a.src, "tools": status, "plan": steps}
    return meta, findings, ai_text


def main(argv: list[str] | None = None) -> int:
    a = parse_args(argv)
    meta, findings, ai_text = run(a)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".md").write_text(report.to_markdown(meta, findings, ai_text), "utf-8")
    out.with_suffix(".json").write_text(report.to_json(meta, findings, ai_text), "utf-8")
    print(f"\n{len(findings)} findings · risk {report.risk_score(findings)}/100 · report: {out.with_suffix('.md')}")
    for f in findings[:10]:
        print(f"  [{f['severity']:>8}] {f['owasp']} {f['title']}")
    if a.fail_on != "never" and any(severity_rank(f["severity"]) >= severity_rank(a.fail_on) for f in findings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
