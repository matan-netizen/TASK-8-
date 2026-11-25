# דוח אבטחה: Sentinel

- **יעד:** http://localhost:3201
- **קוד מקור:** TASK-8 (main)
- **תאריך:** 2026-11-25 08:55 UTC
- **ציון סיכון:** 98/100 (0 = נקי)
- **ממצאים:** 🟥 קריטית: 1 · 🟧 גבוהה: 2 · 🟨 בינונית: 5 · 🟦 נמוכה: 3

## כיסוי OWASP Top 10:2025

| קטגוריה | שם | ממצאים |
|---|---|---|
| A01 | Broken Access Control | 1 |
| A02 | Security Misconfiguration | 5 |
| A03 | Software Supply Chain Failures | 2 |
| A04 | Cryptographic Failures | ✔ |
| A05 | Injection | ✔ |
| A06 | Insecure Design | 1 |
| A07 | Authentication Failures | 2 |
| A08 | Software or Data Integrity Failures | ✔ |
| A09 | Security Logging and Alerting Failures | ✔ |
| A10 | Mishandling of Exceptional Conditions | ✔ |

## הרצת הכלים

| כלי | תוצאה |
|---|---|
| transport | ok: 0 findings |
| headers | ok: 5 findings |
| cookies | ok: 1 findings |
| sensitive-files | ok: 0 findings |
| cors | ok: 0 findings |
| csrf | ok: 1 findings |
| protected | ok: 0 findings |
| forged-session | ok: 1 findings |
| error-handling | ok: 0 findings |
| rate-limit | ok: 1 findings |
| nikto | skipped: nikto not installed (apt install nikto) |
| http-requests | 35 |
| bandit | ok: 0 findings |
| npm-audit | ok: 2 findings |
| secrets | ok: 70 files scanned |
| ai-triage | skipped: no ANTHROPIC_API_KEY |

## ממצאים

### 1. 🟥 עוגייה מזויפת מעניקה גישה לנתיב מוגן

- **חומרה:** קריטית · **OWASP:** A07 Authentication Failures · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/api/notifications`
- **ראיה:** `ללא עוגייה: HTTP 401; עם 'demo_user=m1': HTTP 200 {"notifications":[]}`
- **תיקון:** לא לסמוך על ערך עוגייה שהלקוח יכול לכתוב: לחתום אותה (HMAC) או לשמור סשן בצד השרת.

### 2. 🟧 בקשת POST מאתר זר התקבלה: /api/session

- **חומרה:** גבוהה · **OWASP:** A01 Broken Access Control · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/api/session`
- **ראיה:** `Origin: https://evil.example → HTTP 200`
- **תיקון:** לבדוק את הכותרת Origin/Referer בכל בקשה משנה, או להשתמש ב-CSRF token; SameSite=Strict.

### 3. 🟧 ערך העוגייה demo_user קצר וצפוי ('m1'), ככל הנראה לא חתום

- **חומרה:** גבוהה · **OWASP:** A07 Authentication Failures · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/`
- **ראיה:** `demo_user=m1; Path=/; HttpOnly; SameSite=lax`
- **תיקון:** לחתום את העוגייה (HMAC) או להשתמש במזהה סשן אקראי ארוך שנשמר בשרת.

### 4. 🟨 אין הגנה מפני Clickjacking

- **חומרה:** בינונית · **OWASP:** A02 Security Misconfiguration · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/`
- **ראיה:** `הכותרת חסרה בתשובה ל-GET / (HTTP 200)`
- **תיקון:** X-Frame-Options: DENY או frame-ancestors 'none' ב-CSP.

### 5. 🟨 חסרה כותרת Content-Security-Policy

- **חומרה:** בינונית · **OWASP:** A02 Security Misconfiguration · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/`
- **ראיה:** `הכותרת חסרה בתשובה ל-GET / (HTTP 200)`
- **תיקון:** להגדיר CSP מגביל (default-src 'self'; object-src 'none'; frame-ancestors 'none').

### 6. 🟨 ספרייה פגיעה: exceljs (>=3.5.0)

- **חומרה:** בינונית · **OWASP:** A03 Software Supply Chain Failures · **מקור:** npm-audit
- **מיקום:** `package-lock.json`
- **ראיה:** `דרך uuid`
- **תיקון:** לעדכן את הספרייה, או להגדיר overrides לגרסה מתוקנת.

### 7. 🟨 ספרייה פגיעה: uuid (<11.1.1)

- **חומרה:** בינונית · **OWASP:** A03 Software Supply Chain Failures · **מקור:** npm-audit
- **מיקום:** `package-lock.json`
- **ראיה:** `uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided`
- **תיקון:** לעדכן את הספרייה, או להגדיר overrides לגרסה מתוקנת.

### 8. 🟨 אין הגבלת קצב על /api/session

- **חומרה:** בינונית · **OWASP:** A06 Insecure Design · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/api/session`
- **ראיה:** `15 בקשות ברצף, אף אחת לא נחסמה (סטטוסים: [200])`
- **תיקון:** להגביל ניסיונות לכל משתמש/IP ולהחזיר 429.

### 9. 🟦 חשיפת טכנולוגיה בכותרת x-powered-by

- **חומרה:** נמוכה · **OWASP:** A02 Security Misconfiguration · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/`
- **ראיה:** `x-powered-by: Next.js`
- **תיקון:** להסיר את הכותרת (ב-Next.js: poweredByHeader: false).

### 10. 🟦 חסרה X-Content-Type-Options: nosniff

- **חומרה:** נמוכה · **OWASP:** A02 Security Misconfiguration · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/`
- **ראיה:** `הכותרת חסרה בתשובה ל-GET / (HTTP 200)`
- **תיקון:** להוסיף X-Content-Type-Options: nosniff.

### 11. 🟦 חסרה Referrer-Policy

- **חומרה:** נמוכה · **OWASP:** A02 Security Misconfiguration · **מקור:** sentinel
- **מיקום:** `http://localhost:3201/`
- **ראיה:** `הכותרת חסרה בתשובה ל-GET / (HTTP 200)`
- **תיקון:** להוסיף Referrer-Policy: strict-origin-when-cross-origin.

---
_נוצר על ידי Sentinel. סרקו רק מערכות שבבעלותכם או שיש לכם אישור לבדוק._