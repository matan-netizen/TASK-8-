import type { ChatChannel, Priority, TaskDraft } from "./types";
import type { ChatContextTask } from "./ai";

/**
 * Deterministic "demo mode" stand-ins for the language model, used when no
 * ANTHROPIC_API_KEY is configured. They only reuse information actually
 * present in the manager's text and never invent deadlines or requirements.
 */

const DEADLINE_PATTERNS: RegExp[] = [
  /עד\s+(?:ל)?(?:ה)?יום\s+(?:ה)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|א'|ב'|ג'|ד'|ה'|ו')/,
  /עד\s+(?:ל)?(?:סוף\s+(?:ה)?(?:שבוע|חודש|יום|רבעון))/,
  /עד\s+(?:מחר|מחרתיים|הערב|היום|הבוקר|הצהריים)(?:\s+(?:בבוקר|בערב|בצהריים))?/,
  /עד\s+(?:ה)?(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/,
  /עד\s+(?:ה)?שעה\s+\d{1,2}(?::\d{2})?/,
  /תוך\s+(?:\d+\s+(?:ימים|שעות|שבועות|דקות)|יומיים|שבועיים|שבוע|יום|שעה|שעתיים|חודש)/,
  /(?:by|until|before)\s+[a-z0-9 ,/.-]{2,30}/i,
];

export function extractDeadline(text: string): string | null {
  for (const re of DEADLINE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

export function extractPriority(text: string): Priority | null {
  if (/לא\s+דחוף|כשיש\s+זמן|בלי\s+לחץ|עדיפות\s+נמוכה|low priority/i.test(text)) return "low";
  if (/דחוף|בדחיפות|בהקדם|מיידי|מייד|ASAP|קריטי|עדיפות\s+גבוהה|urgent/i.test(text)) return "high";
  if (/עדיפות\s+בינונית|medium priority/i.test(text)) return "medium";
  return null;
}

const DELIVERABLES: Array<[RegExp, string]> = [
  [/מצגת/, "מצגת"],
  [/דו"ח|דוח|דו״ח|report/i, "דוח"],
  [/אקסל|טבלה|גיליון|excel|spreadsheet/i, "טבלה / גיליון נתונים"],
  [/מייל|אימייל|דוא"ל|email/i, "מייל"],
  [/מסמך|document/i, "מסמך"],
  [/סיכום|summary/i, "סיכום כתוב"],
  [/תוכנית|תכנית|plan/i, "תוכנית עבודה כתובה"],
  [/רשימה|list/i, "רשימה מסודרת"],
  [/הצעת\s+מחיר/, "הצעת מחיר"],
];

export function extractDeliverable(text: string): string | null {
  for (const [re, label] of DELIVERABLES) if (re.test(text)) return label;
  return null;
}

function cleanTitle(text: string, deadline: string | null): string {
  let t = text.split(/[\n.!?]/)[0] ?? text;
  if (deadline) t = t.replace(deadline, "");
  t = t
    .replace(/(^|\s)(?:דחוף|בדחיפות|בהקדם|ASAP)(?=[\s,.]|$)/gi, "$1")
    .replace(/^(?:היי|הי|שלום)[,\s]+/, "")
    .replace(/^(?:בבקשה|אפשר|תוכל|תוכלי|צריך|צריכה|נא)\s+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\s-]+$/, "")
    .trim();
  if (!t) t = text.trim();
  if (t.length > 60) t = t.slice(0, 57).trimEnd() + "...";
  return t;
}

export function demoAnalyze(raw: string): TaskDraft {
  const text = raw.trim();
  const deadline = extractDeadline(text);
  const priority = extractPriority(text);
  const deliverableLabel = extractDeliverable(text);
  const title = cleanTitle(text, deadline);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const clarificationQuestions: string[] = [];
  if (wordCount < 4) clarificationQuestions.push("התיאור קצר מאוד — אפשר לפרט מה בדיוק נדרש?");
  if (!deadline) clarificationQuestions.push("האם יש מועד יעד להשלמת המשימה?");
  if (!deliverableLabel)
    clarificationQuestions.push("מה התוצר המצופה בסיום המשימה (למשל דוח, מצגת, מייל)?");

  const deliverable = deliverableLabel
    ? `${deliverableLabel}, בהתאם לבקשת המנהל`
    : "לא צוין תוצר מוגדר — יש לאשר מול המנהל לפני תחילת העבודה";

  const steps = [
    "לקרוא את תיאור המשימה ולוודא הבנה מלאה של הדרישה",
    "לאסוף את המידע והחומרים הנדרשים לביצוע",
    "לבצע את המשימה בהתאם להנחיות",
    deliverableLabel ? `להכין את התוצר: ${deliverableLabel}` : "להכין את התוצר שסוכם מול המנהל",
    "לבדוק את התוצר מול הדרישות לפני הגשה",
    "לסמן את המשימה כבוצעה",
  ];

  return {
    title,
    objective: `להשלים את המשימה: ${title}`,
    instructions:
      `המנהל ביקש: "${text}".\n` +
      "יש לבצע את המשימה בהתאם לתיאור, לתעד את מה שבוצע, ולפנות למנהל בכל שאלה לגבי פרטים שלא צוינו.",
    steps,
    deliverable,
    deadline,
    priority,
    clarificationQuestions,
  };
}

const PRIORITY_LABEL: Record<Priority, string> = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };

export function demoChat(channel: ChatChannel, task: ChatContextTask, message: string): string {
  const q = message.trim();
  if (channel === "employee") return demoEmployeeReply(task, q);
  return demoManagerReply(task, q);
}

function demoEmployeeReply(task: ChatContextTask, q: string): string {
  const askManager = "אם משהו עדיין לא ברור, מומלץ לפנות ישירות למנהל לקבלת הבהרה.";

  if (/מתי|דדליין|deadline|מועד|עד\s+מתי|כמה\s+זמן/i.test(q)) {
    return task.deadline
      ? `מועד היעד שצוין למשימה: ${task.deadline}.`
      : `לא צוין מועד יעד למשימה. ${askManager}`;
  }
  if (/עדיפות|דחוף|חשוב/.test(q)) {
    return task.priority
      ? `העדיפות שנקבעה למשימה: ${PRIORITY_LABEL[task.priority]}.`
      : `לא נקבעה עדיפות למשימה. ${askManager}`;
  }
  if (/תוצר|להגיש|הגשה|מה\s+צריך\s+להיות\s+בסוף|deliverable/i.test(q)) {
    return `התוצר המצופה: ${task.deliverable}.\nלפני ההגשה כדאי לבדוק שהתוצר עונה על המטרה: ${task.objective}.`;
  }
  if (/סיימתי|גמרתי|בוצע|השלמתי/.test(q)) {
    return "אם כל השלבים הושלמו והתוצר נבדק מול הדרישות, אפשר ללחוץ על \"סמן כבוצעה\" והמנהל יקבל התראה.";
  }
  if (/שלב|איך|מאיפה|להתחיל|מה\s+לעשות|הסבר/.test(q)) {
    const steps = task.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    return `הנה השלבים המוצעים למשימה "${task.title}":\n${steps}\n\n${askManager}`;
  }
  return (
    `לגבי המשימה "${task.title}":\n` +
    `המטרה: ${task.objective}\n` +
    `ההנחיות: ${task.instructions}\n\n` +
    "אני עוזר וירטואלי — אני יכול להסביר ולהציע דרכי פעולה, אבל לא לבצע את העבודה בפועל. " +
    askManager
  );
}

function demoManagerReply(task: ChatContextTask, q: string): string {
  const missing: string[] = [];
  if (!task.deadline) missing.push("מועד יעד");
  if (!task.priority) missing.push("עדיפות");
  if (/לא צוין תוצר/.test(task.deliverable)) missing.push("תוצר מצופה");

  const open = (task.clarificationQuestions ?? []).map((c) => `• ${c}`).join("\n");

  if (/חסר|לשפר|שפר|שיפור|ניסוח|לחדד|בהיר/.test(q)) {
    const parts = [
      missing.length ? `שדות שכדאי להשלים: ${missing.join(", ")}.` : "כל השדות המרכזיים מולאו.",
      open ? `שאלות פתוחות:\n${open}` : "",
      "כדאי לוודא שההנחיות כוללות את ההקשר הדרוש לעובד ושהתוצר מוגדר באופן מדיד.",
    ].filter(Boolean);
    return parts.join("\n\n");
  }
  if (/מתי|מועד|דדליין|עדיפות|דחוף/.test(q)) {
    return "ניתן לעדכן את מועד היעד ואת העדיפות בטופס פרטי המשימה ולשמור לפני השיוך לעובד. אני לא קובע מועדים בעצמי — רק מה שתזין.";
  }
  return (
    `סיכום המשימה "${task.title}":\n` +
    `מטרה: ${task.objective}\n` +
    `תוצר: ${task.deliverable}\n` +
    `מועד יעד: ${task.deadline ?? "לא צוין"} · עדיפות: ${task.priority ? PRIORITY_LABEL[task.priority] : "לא צוינה"}\n\n` +
    (missing.length ? `מומלץ להשלים: ${missing.join(", ")}.\n` : "") +
    (open ? `שאלות פתוחות:\n${open}\n` : "") +
    "אפשר לערוך את כל השדות לפני השיוך לעובד."
  );
}
