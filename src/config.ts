/**
 * Resolve the set of journals to process for a run.
 *
 * Two ways to configure:
 *
 *   (1) Single journal — the original flat env vars (VAULT_NAME, EMAIL_TO,
 *       VAULT_ROOT_PATH or GITHUB_REPO/GITHUB_TOKEN, ...). Unchanged: an
 *       existing single-journal deploy keeps working with no edits.
 *
 *   (2) Multiple journals — set JOURNALS to a JSON array. Each entry is its
 *       own vault (different repo + recipient, same note format), e.g.
 *
 *         JOURNALS='[
 *           {"name":"ADP Journal","to":"me@example.com","repo":"me/journal"},
 *           {"name":"Annette","to":"annette@example.com","repo":"me/annette-journal"}
 *         ]'
 *
 *       Per-entry source is local (`rootPath`) or github (`repo` [+ `token`]).
 *       `token`, `redirectBase`, and the github cache base fall back to the
 *       shared top-level env vars so common values needn't be repeated.
 *
 * Resend delivery (RESEND_API_KEY, EMAIL_FROM) is always shared across all
 * journals.
 */

import { join } from "node:path";

export type JournalSource =
  | { kind: "local"; rootPath: string }
  | { kind: "github"; repo: string; token: string; cacheDir: string };

export interface JournalConfig {
  /** Vault folder name; also the Obsidian vault name for obsidian:// links. */
  name: string;
  /** Recipient email address. */
  to: string;
  source: JournalSource;
  redirectBase?: string;
}

export interface Delivery {
  apiKey: string;
  from: string;
}

export interface RunConfig {
  journals: JournalConfig[];
  delivery: Delivery;
}

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

/** A filesystem-safe slug for a per-journal cache subdir. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "journal";
}

/** Raw shape of a JOURNALS array entry (all strings, all optional but validated). */
interface JournalEntry {
  name?: string;
  to?: string;
  rootPath?: string;
  repo?: string;
  token?: string;
  cacheDir?: string;
  redirectBase?: string;
}

/**
 * Resolve one journal's source. Prefers local (`rootPath`) over github
 * (`repo`); for github, `token` and the cache base fall back to shared env.
 */
function resolveSource(
  label: string,
  rootPath: string | undefined,
  repo: string | undefined,
  token: string | undefined,
  cacheDir: string,
): JournalSource {
  if (rootPath) return { kind: "local", rootPath };
  if (repo) {
    const t = token ?? process.env.GITHUB_TOKEN;
    if (!t) throw new Error(`Journal "${label}": github mode needs a token (per-journal or GITHUB_TOKEN)`);
    return { kind: "github", repo, token: t, cacheDir };
  }
  throw new Error(`Journal "${label}": needs a source — set "rootPath" (local) or "repo" (github)`);
}

function fromJournalsJson(raw: string): JournalConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JOURNALS is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("JOURNALS must be a non-empty JSON array");
  }

  const cacheBase = process.env.VAULT_CACHE_DIR ?? "./.vault-cache";
  return parsed.map((e: JournalEntry, i) => {
    const label = e.name ?? `#${i + 1}`;
    if (!e.name) throw new Error(`Journal ${label}: missing "name"`);
    if (!e.to) throw new Error(`Journal "${label}": missing "to"`);
    // Each github journal gets its own cache subdir so concurrent clones of
    // different repos never clobber one another.
    const cacheDir = e.cacheDir ?? join(cacheBase, slug(e.name));
    return {
      name: e.name,
      to: e.to,
      source: resolveSource(e.name, e.rootPath, e.repo, e.token, cacheDir),
      redirectBase: e.redirectBase ?? process.env.REDIRECT_BASE_URL,
    };
  });
}

/** The original single-journal config, built from flat env vars. */
function fromFlatEnv(): JournalConfig {
  const name = env("VAULT_NAME");
  const cacheDir = process.env.VAULT_CACHE_DIR ?? "./.vault-cache";
  return {
    name,
    to: env("EMAIL_TO"),
    source: resolveSource(name, process.env.VAULT_ROOT_PATH, process.env.GITHUB_REPO, process.env.GITHUB_TOKEN, cacheDir),
    redirectBase: process.env.REDIRECT_BASE_URL,
  };
}

export function loadConfig(): RunConfig {
  const journals = process.env.JOURNALS ? fromJournalsJson(process.env.JOURNALS) : [fromFlatEnv()];
  return {
    journals,
    delivery: { apiKey: env("RESEND_API_KEY"), from: env("EMAIL_FROM") },
  };
}
