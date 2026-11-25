# דוח אבטחה: Sentinel

- **יעד:** http://localhost:3202
- **קוד מקור:** TASK-8 (security-owasp-2025)
- **תאריך:** 2026-11-25 08:55 UTC
- **ציון סיכון:** 0/100 (0 = נקי)
- **ממצאים:** אין ✅

## כיסוי OWASP Top 10:2025

| קטגוריה | שם | ממצאים |
|---|---|---|
| A01 | Broken Access Control | ✔ |
| A02 | Security Misconfiguration | ✔ |
| A03 | Software Supply Chain Failures | ✔ |
| A04 | Cryptographic Failures | ✔ |
| A05 | Injection | ✔ |
| A06 | Insecure Design | ✔ |
| A07 | Authentication Failures | ✔ |
| A08 | Software or Data Integrity Failures | ✔ |
| A09 | Security Logging and Alerting Failures | ✔ |
| A10 | Mishandling of Exceptional Conditions | ✔ |

## הרצת הכלים

| כלי | תוצאה |
|---|---|
| transport | ok: 0 findings |
| headers | ok: 0 findings |
| cookies | ok: 0 findings |
| sensitive-files | ok: 0 findings |
| cors | ok: 0 findings |
| csrf | ok: 0 findings |
| protected | ok: 0 findings |
| forged-session | ok: 0 findings |
| error-handling | ok: 0 findings |
| rate-limit | ok: 0 findings |
| nikto | skipped: nikto not installed (apt install nikto) |
| http-requests | 30 |
| bandit | ok: 0 findings |
| npm-audit | ok: 0 findings |
| secrets | ok: 60 files scanned |
| ai-triage | skipped: no findings |

## ממצאים

לא נמצאו ממצאים בבדיקות שהורצו.
---
_נוצר על ידי Sentinel. סרקו רק מערכות שבבעלותכם או שיש לכם אישור לבדוק._