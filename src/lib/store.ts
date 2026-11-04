import { promises as fs } from "fs";
import path from "path";
import type { Database } from "./types";

/**
 * Lightweight local persistence: a single JSON file written atomically
 * (temp file + rename). All mutations are serialized through an in-process
 * queue so concurrent requests cannot interleave read-modify-write cycles.
 */

function dataFile(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "db.json");
}

const empty = (): Database => ({ tasks: [], messages: [], notifications: [] });

type StoreGlobal = { __taskStoreQueue?: Promise<unknown> };
const g = globalThis as StoreGlobal;

async function readDb(): Promise<Database> {
  try {
    const raw = await fs.readFile(dataFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      // Older records predate the knowledge base fields.
      tasks: (parsed.tasks ?? []).map((t) => ({ ...t, projectId: t.projectId ?? null, knowledgeSources: t.knowledgeSources ?? [] })),
      messages: parsed.messages ?? [],
      notifications: parsed.notifications ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw err;
  }
}

async function writeDb(db: Database): Promise<void> {
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__taskStoreQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  g.__taskStoreQueue = next.catch(() => undefined);
  return next;
}

/** Read a consistent snapshot. */
export function read<T>(fn: (db: Database) => T): Promise<T> {
  return enqueue(async () => fn(await readDb()));
}

/**
 * Run a mutation atomically. The callback may modify `db` in place; it is
 * saved only if the callback returns without throwing.
 */
export function mutate<T>(fn: (db: Database) => T): Promise<T> {
  return enqueue(async () => {
    const db = await readDb();
    const result = fn(db);
    await writeDb(db);
    return result;
  });
}
