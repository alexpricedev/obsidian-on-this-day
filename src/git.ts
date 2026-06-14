import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface SyncOptions {
  /** GitHub repo in "owner/name" form */
  repo: string;
  /** Personal access token with read-only Contents scope */
  token: string;
  /** Local directory to hold the clone (persist via a volume to make runs cheap) */
  cacheDir: string;
  /** Vault folder inside the repo to fetch (e.g. "ADP Journal"); omit to fetch all */
  subdir?: string;
}

/**
 * Ensures `cacheDir` contains an up-to-date checkout of the vault repo and
 * returns the path to scan (the subdir if given, else the repo root).
 *
 * The clone is deliberately cheap so it fits a short-lived cron container's
 * ephemeral filesystem (Railway's free tier caps this at 1GB):
 *   --filter=blob:none  fetch commit/tree metadata only; blobs are lazy
 *   --depth 1           skip history (the date resolver uses filenames/frontmatter)
 *   sparse-checkout     materialise only the *.md under `subdir`, never the
 *                       embedded photos — those blobs are never downloaded
 *
 * First run clones; later runs fast-forward pull (useful only when `cacheDir`
 * is backed by a volume, otherwise every run is a fresh — but tiny — clone).
 */
export async function syncVault({ repo, token, cacheDir, subdir }: SyncOptions): Promise<string> {
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  const patterns = subdir ? [`/${subdir}/**/*.md`, `/${subdir}/*.md`] : ["/**/*.md"];

  if (existsSync(join(cacheDir, ".git"))) {
    await $`git -C ${cacheDir} pull --ff-only`.quiet();
  } else {
    await $`git clone --filter=blob:none --depth 1 --no-checkout ${url} ${cacheDir}`.quiet();
    await $`git -C ${cacheDir} sparse-checkout set --no-cone ${patterns}`.quiet();
    await $`git -C ${cacheDir} checkout`.quiet();
  }

  return subdir ? join(cacheDir, subdir) : cacheDir;
}
