"""Tests for Sentinel against two tiny local servers: one deliberately
vulnerable, one hardened. Run: python -m unittest discover -s tests"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sentinel import agent, tools, web  # noqa: E402
from sentinel.findings import Finding  # noqa: E402


def make_handler(hardened: bool):
    hits = {"login": 0}

    class H(BaseHTTPRequestHandler):
        if hardened:
            server_version, sys_version = "srv", ""

        def log_message(self, *a):
            pass

        def _send(self, code, body="", headers=None):
            self.send_response(code)
            hs = headers or {}
            if hardened:
                hs.update({
                    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
                    "X-Content-Type-Options": "nosniff",
                    "Referrer-Policy": "no-referrer",
                })
            else:
                hs.update({"X-Powered-By": "Express", "Access-Control-Allow-Origin": self.headers.get("Origin", "*"),
                           "Access-Control-Allow-Credentials": "true"})
            for k, v in hs.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body.encode())

        def do_GET(self):
            if self.path == "/.env" and not hardened:
                return self._send(200, "SECRET=1")
            if self.path == "/api/private":
                cookie = self.headers.get("Cookie", "")
                if (not hardened and "session=admin" in cookie):
                    return self._send(200, '{"secret": true}')
                return self._send(401, '{"error":"login"}')
            if self.path == "/api/open":
                return self._send(200 if not hardened else 401, "{}")
            return self._send(200, "<html>ok</html>")

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            origin = self.headers.get("Origin")
            if self.path == "/login":
                if hardened and origin and origin != f"http://{self.headers['Host']}":
                    return self._send(403, "{}")
                hits["login"] += 1
                if hardened and hits["login"] > 5:
                    return self._send(429, "{}")
                c = ("sid=" + "a" * 40 + "; HttpOnly; SameSite=Strict") if hardened else "session=admin"
                return self._send(200, "{}", {"Set-Cookie": c})
            if self.path == "/api/data":
                try:
                    json.loads(raw)
                except ValueError:
                    if hardened:
                        return self._send(400, '{"error":"bad json"}')
                    return self._send(500, 'Traceback (most recent call last):\n  File "/home/app/x.py"')
                return self._send(200, "{}")
            return self._send(404, "")

    return H


class ServerCase(unittest.TestCase):
    hardened = False

    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cls.hardened))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
        cls.out = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        shutil.rmtree(cls.out, ignore_errors=True)

    def scan(self):
        args = agent.parse_args([
            "--url", self.url, "--login-path", "/login", "--csrf-path", "/login",
            "--protected", "/api/private", "--protected", "/api/open", "--forged-cookie", "session=admin",
            "--error-path", "/api/data", "--no-nikto", "--no-ai", "--out", os.path.join(self.out, "r"),
        ])
        meta, findings, _ = agent.run(args, log=lambda *_: None)
        return meta, {f["check"] for f in findings}, findings


class VulnerableServer(ServerCase):
    hardened = False

    def test_detects_owasp_issues(self):
        _, checks, findings = self.scan()
        expected = {
            "web.headers.csp", "web.headers.clickjacking", "web.headers.nosniff",   # A02
            "web.disclosure.x-powered-by", "web.exposed-file",                       # A02
            "web.cors.reflect", "web.csrf", "web.auth.unauthenticated",             # A01
            "web.cookie.flags", "web.cookie.predictable",                           # A04 / A07
            "web.auth.forged-cookie",                                               # A07
            "web.errors.leak",                                                      # A10
            "web.ratelimit.missing",                                                # A06
        }
        self.assertTrue(expected <= checks, f"missing: {expected - checks}")
        self.assertEqual(findings[0]["severity"], "critical")  # sorted by severity

    def test_report_and_exit_code(self):
        code = agent.main(["--url", self.url, "--no-nikto", "--no-ai", "--out", os.path.join(self.out, "m")])
        self.assertEqual(code, 1)  # high finding -> CI gate fails
        md = Path(self.out, "m.md").read_text("utf-8")
        self.assertIn("OWASP Top 10:2025", md)
        data = json.loads(Path(self.out, "m.json").read_text("utf-8"))
        self.assertGreater(data["risk_score"], 0)


class HardenedServer(ServerCase):
    hardened = True

    def test_no_false_positives(self):
        _, checks, _ = self.scan()
        self.assertEqual(checks, set(), f"unexpected findings: {checks}")


class StaticAnalysis(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        key = "sk-ant-" + "api03-" + "x" * 30  # assembled so this file itself stays clean
        Path(self.dir, "config.py").write_text(f'API_KEY = "{key}"\n')
        Path(self.dir, "app.py").write_text(
            "import subprocess, hashlib\n"
            "def run(cmd):\n    return subprocess.call(cmd, shell=True)\n"
            "def h(x):\n    return hashlib.md5(x).hexdigest()\n"
            "password = 'hunter2'\n"
        )

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_secrets_are_found_and_masked(self):
        found, _ = tools.secrets(self.dir)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].owasp, "A04")
        self.assertNotIn("x" * 30, found[0].evidence)  # never print the full secret

    @unittest.skipUnless(shutil.which("bandit"), "bandit not installed")
    def test_bandit_mapped_to_owasp(self):
        found, msg = tools.bandit(self.dir)
        ids = {f.check: f.owasp for f in found}
        self.assertIn("bandit.B602", ids)            # shell=True -> injection
        self.assertEqual(ids["bandit.B602"], "A05")
        self.assertEqual(ids.get("bandit.B324"), "A04")  # md5


class NiktoParsing(unittest.TestCase):
    """Run the wrapper against a fake nikto binary that writes CSV."""

    def test_csv_rows_become_findings(self):
        d = tempfile.mkdtemp()
        fake = Path(d, "nikto")
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "out = sys.argv[sys.argv.index('-output') + 1]\n"
            "open(out, 'w').write('\"Nikto - v2.1.5/2.1.5\"\\n'\n"
            "  '\"localhost\",\"127.0.0.1\",\"80\",\"OSVDB-3092\",\"GET\",\"/admin/\",\"/admin/: This might be interesting...\"\\n'\n"
            "  '\"localhost\",\"127.0.0.1\",\"80\",\"\",\"GET\",\"/\",\"The anti-clickjacking X-Frame-Options header is not present.\"\\n')\n")
        fake.chmod(0o755)
        old = os.environ["PATH"]
        os.environ["PATH"] = d + os.pathsep + old
        try:
            found, msg = tools.nikto("http://localhost")
        finally:
            os.environ["PATH"] = old
            shutil.rmtree(d, ignore_errors=True)
        self.assertEqual(msg, "ok: 2 findings")
        self.assertEqual({f.severity for f in found}, {"medium", "low"})
        self.assertTrue(all(f.source == "nikto" for f in found))
        self.assertIn("A02", {f.owasp for f in found})


class Safety(unittest.TestCase):
    def test_remote_target_requires_authorization(self):
        with self.assertRaises(SystemExit):
            agent.parse_args(["--url", "https://example.com"])
        a = agent.parse_args(["--url", "https://example.com", "--authorized"])
        self.assertTrue(a.authorized)

    def test_rejects_non_http_schemes(self):
        with self.assertRaises(SystemExit):
            agent.parse_args(["--url", "file:///etc/passwd"])

    def test_finding_validation(self):
        with self.assertRaises(ValueError):
            Finding("x", "t", "A11", "high", "e", "f")

    def test_plan_depends_on_inputs(self):
        steps = agent.plan(agent.parse_args(["--src", ".", "--no-ai"]))
        self.assertEqual(steps, ["bandit", "npm-audit", "secrets"])


if __name__ == "__main__":
    unittest.main()
