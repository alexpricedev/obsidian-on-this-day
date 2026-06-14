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
    vaultDir = join(process.env.VAULT_ROOT_PATH, vaultName);
  } else {
    const cacheDir = process.env.VAULT_CACHE_DIR ?? "./.vault-cache";
    vaultDir = await syncVault({
      repo: env("GITHUB_REPO"),
      token: env("GITHUB_TOKEN"),
      cacheDir,
      subdir: vaultName,
    });
  }

  const today = londonToday();
  const notes = await loadNotes(vaultDir);

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
  console.error(err);
  process.exit(1);
});
