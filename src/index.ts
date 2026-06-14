import { join } from "node:path";
import { syncVault } from "./git";
import { renderEmail, sendEmail } from "./email";
import { loadNotes, type DateParts, type Note } from "./vault";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

/** Today's date in Europe/London, as plain calendar parts. */
function londonToday(): DateParts {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
}

async function main() {
  const vaultName = env("VAULT_NAME");

  // Two source modes:
  //   local  — VAULT_ROOT_PATH points at a folder already on disk
  //   github — clone the vault repo (used on Railway, which has no local copy)
  let vaultDir: string;
  if (process.env.VAULT_ROOT_PATH) {
    console.log(`Vault source: local (${process.env.VAULT_ROOT_PATH})`);
    vaultDir = join(process.env.VAULT_ROOT_PATH, vaultName);
  } else {
    const repo = env("GITHUB_REPO");
    const cacheDir = process.env.VAULT_CACHE_DIR ?? "./.vault-cache";
    console.log(`Vault source: github (${repo}) → ${cacheDir}`);
    vaultDir = await syncVault({
      repo,
      token: env("GITHUB_TOKEN"),
      cacheDir,
      subdir: vaultName,
    });
  }

  const today = londonToday();
  const notes = await loadNotes(vaultDir);
  console.log(`Loaded ${notes.length} note(s) from "${vaultName}".`);

  // Same month + day, any prior year.
  const matches = notes
    .filter(
      (n): n is Note & { date: DateParts } =>
        n.date !== null &&
        n.date.month === today.month &&
        n.date.day === today.day &&
        n.date.year < today.year,
    )
    .sort((a, b) => b.date.year - a.date.year); // most recent year first

  if (matches.length === 0) {
    console.log("Nothing on this day — skipping email.");
    return;
  }

  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(2000, today.month - 1, today.day)));

  const html = renderEmail(matches, { vaultName, dayLabel });

  await sendEmail({
    apiKey: env("RESEND_API_KEY"),
    from: env("EMAIL_FROM"),
    to: env("EMAIL_TO"),
    subject: `On this day · ${dayLabel} · ${matches.length} note${matches.length > 1 ? "s" : ""}`,
    html,
  });

  console.log(`Sent ${matches.length} note(s) for ${dayLabel}.`);
}

main().catch((err) => {
  // Surface what failed. Bun's ShellError carries the failing exit code but a
  // terse message ("Failed with exit code N") — the underlying git output is
  // already streamed live above, so this just labels the failure. Neither the
  // message nor stderr includes the token (Bun redacts URL credentials).
  console.error("on-this-day run failed:");
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  // Set exitCode rather than process.exit() so buffered logs flush before exit;
  // a non-zero code still marks the scheduled run as failed.
  const code = (err as { exitCode?: number })?.exitCode;
  process.exitCode = typeof code === "number" && code !== 0 ? code : 1;
});
