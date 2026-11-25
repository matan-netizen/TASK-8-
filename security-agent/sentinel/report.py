"""Markdown + JSON report."""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone

from .findings import OWASP_2025, SEVERITIES

ICON = {"critical": "🟥", "high": "🟧", "medium": "🟨", "low": "🟦", "info": "⬜"}
SEV_HE = {"critical": "קריטית", "high": "גבוהה", "medium": "בינונית", "low": "נמוכה", "info": "מידע"}


def risk_score(findings: list[dict]) -> int:
    """0 (clean) .. 100 (very risky)."""
    w = {"critical": 40, "high": 15, "medium": 5, "low": 1, "info": 0}
    return min(100, sum(w[f["severity"]] for f in findings))


def to_json(meta: dict, findings: list[dict], ai_text: str | None) -> str:
    return json.dumps({"meta": meta, "risk_score": risk_score(findings), "findings": findings,
                       "ai_triage": ai_text}, ensure_ascii=False, indent=2)


def to_markdown(meta: dict, findings: list[dict], ai_text: str | None) -> str:
    counts = Counter(f["severity"] for f in findings)
    by_cat = Counter(f["owasp"] for f in findings)
    lines = [
        "# דוח אבטחה: Sentinel",
        "",
        f"- **יעד:** {meta.get('target') or '-'}",
        f"- **קוד מקור:** {meta.get('src') or '-'}",
        f"- **תאריך:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"- **ציון סיכון:** {risk_score(findings)}/100 (0 = נקי)",
        f"- **ממצאים:** " + (" · ".join(f"{ICON[s]} {SEV_HE[s]}: {counts[s]}" for s in reversed(SEVERITIES) if counts[s])
                             or "אין ✅"),
        "",
        "## כיסוי OWASP Top 10:2025",
        "",
        "| קטגוריה | שם | ממצאים |",
        "|---|---|---|",
    ]
    for k, name in OWASP_2025.items():
        lines.append(f"| {k} | {name} | {by_cat[k] or '✔'} |")

    lines += ["", "## הרצת הכלים", "", "| כלי | תוצאה |", "|---|---|"]
    for tool, status in meta.get("tools", {}).items():
        lines.append(f"| {tool} | {status} |")

    if ai_text:
        lines += ["", "# ניתוח AI (Claude)", "", ai_text]

    lines += ["", "## ממצאים", ""]
    if not findings:
        lines.append("לא נמצאו ממצאים בבדיקות שהורצו.")
    for i, f in enumerate(findings, 1):
        lines += [
            f"### {i}. {ICON[f['severity']]} {f['title']}",
            "",
            f"- **חומרה:** {SEV_HE[f['severity']]} · **OWASP:** {f['owasp']} {f['owasp_name']} · **מקור:** {f['source']}",
            f"- **מיקום:** `{f['location']}`" if f["location"] else "",
            f"- **ראיה:** `{f['evidence'].replace('`', 'ʼ')}`",
            f"- **תיקון:** {f['fix']}",
            "",
        ]
    lines += ["---", "_נוצר על ידי Sentinel. סרקו רק מערכות שבבעלותכם או שיש לכם אישור לבדוק._"]
    return "\n".join(l for l in lines if l is not None)
