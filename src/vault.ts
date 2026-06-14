import { $ } from "bun";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface MediaCounts {
  images: number;
  videos: number;
}

export interface Note {
  absPath: string;
  relPath: string; // relative to vault root, used for the obsidian:// link
  title: string;
  body: string; // content with frontmatter stripped
  date: DateParts | null;
  media: MediaCounts; // embedded photos/videos referenced in the note
}

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg|avif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

/**
 * Count embedded media in a note. The vault uses both standard markdown
 * embeds — `![](file.jpeg)` — and Obsidian wikilink embeds — `![[file.mp4]]`
 * (optionally `![[file.jpeg|size]]`). The actual files aren't shipped to the
 * email; these counts drive "2 photos · 1 video" placeholders so the reader
 * knows to open the note in Obsidian.
 */
function countMedia(body: string): MediaCounts {
  const targets: string[] = [];
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) targets.push(m[1]);
  for (const m of body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) targets.push(m[1]);

  let images = 0;
  let videos = 0;
  for (const raw of targets) {
    const path = raw.trim().split(/[?#]/)[0]; // drop any ?query / #anchor
    if (IMAGE_EXT.test(path)) images++;
    else if (VIDEO_EXT.test(path)) videos++;
  }
  return { images, videos };
}

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

function titleOf(body: string, name: string, date: DateParts | null): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();

  // Filename with any ISO date stripped (daily notes like 2022-06-14 leave nothing).
  const fromName = name.replace(ISO_DATE, "").replace(/[-_]+/g, " ").trim();
  // Only use it if it has real words — not leftover digits like "000".
  if (/[a-z]/i.test(fromName)) return fromName;

  // Fall back to the note's date label ("14 June"); the card shows the year.
  if (date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
  }

  return name;
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
    const date = await resolveDate(absPath, name, fm, vaultDir);
    notes.push({
      absPath,
      relPath: relative(vaultDir, absPath),
      title: titleOf(body, name, date),
      body,
      date,
      media: countMedia(body),
    });
  }
  return notes;
}
