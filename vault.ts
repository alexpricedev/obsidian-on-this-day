import { $ } from "bun";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface Note {
  absPath: string;
  relPath: string; // relative to vault root, used for the obsidian:// link
  title: string;
  body: string; // content with frontmatter stripped
  date: DateParts | null;
}

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

function partsFromIso(value: string): DateParts | null {
  const m = value.match(ISO_DATE);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

/** Pull a minimal key/value map out of leading `--- ... ---` frontmatter. */
function splitFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };

  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: raw };

  const block = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");

  const fm: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) fm[key] = val;
  }
  return { fm, body };
}

function titleOf(body: string, name: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return name.replace(ISO_DATE, "").replace(/[-_]+/g, " ").trim() || name;
}

/**
 * Resolve a note's date. Order is intentionally pluggable:
 *   1. an ISO date in the filename (daily notes: 2024-06-13.md)
 *   2. a `date:` or `created:` frontmatter field
 *   3. the file's first git-commit date
 */
async function resolveDate(
  absPath: string,
  name: string,
  fm: Record<string, string>,
  repoDir: string,
): Promise<DateParts | null> {
  const fromName = partsFromIso(name);
  if (fromName) return fromName;

  for (const key of ["date", "created"]) {
    if (fm[key]) {
      const p = partsFromIso(fm[key]);
      if (p) return p;
    }
  }

  try {
    const rel = relative(repoDir, absPath);
    const log = await $`git -C ${repoDir} log --diff-filter=A --follow --format=%aI -- ${rel}`
      .quiet()
      .text();
    const lines = log.trim().split("\n").filter(Boolean);
    const first = lines.at(-1);
    if (first) return partsFromIso(first);
  } catch {
    // not in git history yet — leave undated
  }

  return null;
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip .obsidian, .git, etc.
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
}

export async function loadNotes(vaultDir: string): Promise<Note[]> {
  const files: string[] = [];
  await walk(vaultDir, files);

  const notes: Note[] = [];
  for (const absPath of files) {
    const raw = await readFile(absPath, "utf8");
    const { fm, body } = splitFrontmatter(raw);
    const name = basename(absPath, ".md");
    notes.push({
      absPath,
      relPath: relative(vaultDir, absPath),
      title: titleOf(body, name),
      body,
      date: await resolveDate(absPath, name, fm, vaultDir),
    });
  }
  return notes;
}
