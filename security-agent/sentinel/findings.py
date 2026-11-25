"""Finding model and OWASP Top 10:2025 catalogue."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

OWASP_2025 = {
    "A01": "Broken Access Control",
    "A02": "Security Misconfiguration",
    "A03": "Software Supply Chain Failures",
    "A04": "Cryptographic Failures",
    "A05": "Injection",
    "A06": "Insecure Design",
    "A07": "Authentication Failures",
    "A08": "Software or Data Integrity Failures",
    "A09": "Security Logging and Alerting Failures",
    "A10": "Mishandling of Exceptional Conditions",
}

SEVERITIES = ["info", "low", "medium", "high", "critical"]


def severity_rank(sev: str) -> int:
    return SEVERITIES.index(sev)


@dataclass
class Finding:
    check: str            # stable id, e.g. "web.headers.csp"
    title: str            # Hebrew, one line
    owasp: str            # "A01".."A10"
    severity: str         # info|low|medium|high|critical
    evidence: str         # what was observed (request/response excerpt)
    fix: str              # Hebrew, concrete remediation
    source: str = "sentinel"   # sentinel|nikto|bandit|npm-audit|secrets
    location: str = ""    # URL or file:line
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.owasp not in OWASP_2025:
            raise ValueError(f"unknown OWASP category {self.owasp}")
        if self.severity not in SEVERITIES:
            raise ValueError(f"unknown severity {self.severity}")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["owasp_name"] = OWASP_2025[self.owasp]
        return d
