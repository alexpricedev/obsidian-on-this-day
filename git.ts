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
}

/**
 * Ensures `cacheDir` contains an up-to-date clone of the vault repo.
 * First run clones; later runs fast-forward pull. Returns the repo path.
 *
 * A full clone (no --depth) is used on purpose so the date resolver can read
 * each note's first-commit date as a fallback.
 */
export async function syncVault({ repo, token, cacheDir }: SyncOptions): Promise<string> {
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;

  if (existsSync(join(cacheDir, ".git"))) {
    await $`git -C ${cacheDir} pull --ff-only`.quiet();
  } else {
    await $`git clone ${url} ${cacheDir}`.quiet();
  }

  return cacheDir;
}
