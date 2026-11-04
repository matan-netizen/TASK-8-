import { promises as fs } from "fs";
import path from "path";

/**
 * Knowledge base ("מאגר מידע"): company documents the AI uses as context.
 *
 * Documents live in a local folder (KNOWLEDGE_DIR, default ./knowledge) that
 * is NOT committed to git, because it holds client business content. Each
 * top-level sub-folder is a project; files directly in the root belong to
 * "כללי". If the folder does not exist, the committed fictional sample in
 * ./knowledge.example is used so the feature stays testable.
 *
 * Supported: .md .txt .csv .docx .xlsx (Google Docs/Sheets downloaded from
 * Drive arrive as .docx/.xlsx). Other files (videos, images) are listed as
 * skipped.
 */

export const GENERAL_PROJECT = "כללי";
const SUPPORTED = new Set([".md", ".txt", ".csv", ".docx", ".xlsx"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const CHUNK_CHARS = 900;
const MAX_DEPTH = 5;

export interface KnowledgeDoc {
  id: string; // relative path, stable across restarts
  title: string;
  project: string;
  ext: string;
  modifiedAt: string;
  chars: number;
  error?: string;
}

export interface KnowledgeChunk {
  docId: string;
  title: string;
  project: string;
  text: string;
  tokens: Map<string, number>;
}

export interface KnowledgeIndex {
  dir: string;
  isSample: boolean;
  docs: KnowledgeDoc[];
  skipped: string[];
  chunks: KnowledgeChunk[];
  idf: Map<string, number>;
}

export interface KnowledgeHit {
  docId: string;
  title: string;
  project: string;
  excerpt: string;
  score: number;
}

import type { KnowledgeSource } from "./types";
export type { KnowledgeSource };

// ---------- text processing ----------

const STOPWORDS = new Set(
  "של את על עם זה זו גם או אם כי לא כן יש אין הוא היא הם הן אני אתה אנחנו מה מי איך כל עד אל רק עוד כמו לי לך לו לה לנו שלי שלך שלו שלה אבל כדי היה היו להיות the and for with from this that".split(
    " ",
  ),
);
const HEB_PREFIX = /^[והבלמשכ]/;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const t = raw.replace(/["'״׳]/g, "");
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(t);
    // Also index the word without up to two Hebrew prefix letters
    // (ו/ה/ב/ל/מ/ש/כ), e.g. "ולקבוצה" -> "לקבוצה", "קבוצה".
    if (/[֐-׿]/.test(t)) {
      let w = t;
      for (let i = 0; i < 2 && w.length > 3 && HEB_PREFIX.test(w); i++) {
        w = w.slice(1);
        if (!STOPWORDS.has(w)) out.push(w);
      }
    }
  }
  return out;
}

function counts(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export function chunkText(text: string): string[] {
  const paras = text
    .replace(/\r/g, "")
    .split(/\n\s*\n|\n(?=[-*•\d])/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > CHUNK_CHARS) {
      if (cur) chunks.push(cur);
      cur = "";
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (cur && cur.length + p.length + 1 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---------- file extraction ----------

async function extractText(file: string, ext: string): Promise<string> {
  const buf = await fs.readFile(file);
  if (ext === ".md" || ext === ".txt" || ext === ".csv") return buf.toString("utf8");
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value;
  }
  if (ext === ".xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const lines: string[] = [];
    wb.eachSheet((sheet) => {
      lines.push(`גיליון: ${sheet.name}`);
      sheet.eachRow((row) => {
        const cells: string[] = [];
        row.eachCell((c) => {
          const v = (c.text ?? "").toString().trim();
          if (v) cells.push(v);
        });
        if (cells.length) lines.push(cells.join(" | "));
      });
      lines.push("");
    });
    return lines.join("\n");
  }
  return "";
}

// ---------- index ----------

function rootDir(): { dir: string; isSample: boolean } {
  const configured = process.env.KNOWLEDGE_DIR || path.join(process.cwd(), "knowledge");
  return { dir: configured, isSample: false };
}

const SAMPLE_DIR = () => path.join(process.cwd(), "knowledge.example");

async function exists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function walk(
  dir: string,
  base: string,
  depth: number,
  files: { abs: string; rel: string; mtimeMs: number; size: number }[],
) {
  if (depth > MAX_DEPTH) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("~$") || e.name.toLowerCase() === "readme.md") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(abs, base, depth + 1, files);
    else if (e.isFile()) {
      const st = await fs.stat(abs);
      files.push({ abs, rel: path.relative(base, abs), mtimeMs: st.mtimeMs, size: st.size });
    }
  }
}

type KbGlobal = { __kb?: { signature: string; index: KnowledgeIndex } };
const g = globalThis as KbGlobal;

/** Builds (or returns the cached) index; rebuilt automatically when files change. */
export async function getKnowledgeIndex(): Promise<KnowledgeIndex> {
  let { dir, isSample } = rootDir();
  if (!(await exists(dir))) {
    const sample = SAMPLE_DIR();
    if (await exists(sample)) {
      dir = sample;
      isSample = true;
    } else {
      return { dir, isSample: false, docs: [], skipped: [], chunks: [], idf: new Map() };
    }
  }

  const files: { abs: string; rel: string; mtimeMs: number; size: number }[] = [];
  await walk(dir, dir, 0, files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const signature = dir + "|" + files.map((f) => `${f.rel}:${f.mtimeMs}:${f.size}`).join("|");
  if (g.__kb?.signature === signature) return g.__kb.index;

  const docs: KnowledgeDoc[] = [];
  const skipped: string[] = [];
  const chunks: KnowledgeChunk[] = [];

  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    if (!SUPPORTED.has(ext)) {
      skipped.push(f.rel);
      continue;
    }
    const parts = f.rel.split(path.sep);
    const project = parts.length > 1 ? parts[0] : GENERAL_PROJECT;
    const title = path.basename(f.rel, path.extname(f.rel)).trim();
    const doc: KnowledgeDoc = {
      id: f.rel.split(path.sep).join("/"),
      title,
      project,
      ext,
      modifiedAt: new Date(f.mtimeMs).toISOString(),
      chars: 0,
    };
    if (f.size > MAX_FILE_BYTES) {
      doc.error = "הקובץ גדול מדי";
      docs.push(doc);
      continue;
    }
    try {
      const text = (await extractText(f.abs, ext)).trim();
      doc.chars = text.length;
      for (const c of chunkText(text)) {
        chunks.push({
          docId: doc.id,
          title,
          project,
          text: c,
          tokens: counts([...tokenize(c), ...tokenize(title)]),
        });
      }
    } catch (err) {
      console.error(`[knowledge] failed to read ${f.rel}:`, err);
      doc.error = "לא ניתן היה לקרוא את הקובץ";
    }
    docs.push(doc);
  }

  const df = new Map<string, number>();
  for (const c of chunks) for (const t of c.tokens.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + chunks.length / n));

  const index: KnowledgeIndex = { dir, isSample, docs, skipped, chunks, idf };
  g.__kb = { signature, index };
  return index;
}

export function listProjects(index: KnowledgeIndex): { name: string; docs: number }[] {
  const m = new Map<string, number>();
  for (const d of index.docs) m.set(d.project, (m.get(d.project) ?? 0) + 1);
  return [...m.entries()]
    .map(([name, docs]) => ({ name, docs }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/** Keyword search (TF-IDF), optionally limited to one project (plus "כללי"). */
export function searchKnowledge(
  index: KnowledgeIndex,
  query: string,
  opts: { project?: string | null; limit?: number } = {},
): KnowledgeHit[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const limit = opts.limit ?? 5;
  const scored: KnowledgeHit[] = [];
  for (const c of index.chunks) {
    if (opts.project && c.project !== opts.project && c.project !== GENERAL_PROJECT) continue;
    let score = 0;
    for (const t of q) {
      const tf = c.tokens.get(t);
      if (tf) score += (1 + Math.log(tf)) * (index.idf.get(t) ?? 0);
    }
    if (opts.project && c.project === opts.project) score *= 1.25;
    if (score > 0) {
      scored.push({ docId: c.docId, title: c.title, project: c.project, excerpt: c.text, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Picks the project whose name appears in the text, if exactly one matches. */
export function detectProject(index: KnowledgeIndex, text: string): string | null {
  const tokens = new Set(tokenize(text));
  const matches = listProjects(index)
    .map((p) => p.name)
    .filter((name) => name !== GENERAL_PROJECT)
    .filter((name) => {
      const nameTokens = tokenize(name).filter((t) => t !== "פרויקט" && t !== "פרוייקט");
      return nameTokens.length > 0 && nameTokens.some((t) => tokens.has(t));
    });
  return matches.length === 1 ? matches[0] : null;
}

/** Deduplicated source list (titles only) for a set of hits. */
export function toSources(hits: KnowledgeHit[]): KnowledgeSource[] {
  const seen = new Set<string>();
  const out: KnowledgeSource[] = [];
  for (const h of hits) {
    if (seen.has(h.docId)) continue;
    seen.add(h.docId);
    out.push({ docId: h.docId, title: h.title, project: h.project });
  }
  return out;
}

/** Formats hits for a model prompt, clearly delimited as reference data. */
export function formatForPrompt(hits: KnowledgeHit[], maxChars = 6000): string {
  let total = 0;
  const parts: string[] = [];
  for (const h of hits) {
    const block = `<document title="${h.title.replace(/"/g, "'")}" project="${h.project.replace(/"/g, "'")}">\n${h.excerpt}\n</document>`;
    if (total + block.length > maxChars) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join("\n");
}
