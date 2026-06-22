import { join } from "node:path";
import { syncVault } from "./git";
import { renderEmail, sendEmail } from "./email";
import { loadNotes, type DateParts, type Note } from "./vault";
import { loadConfig, type Delivery, type JournalConfig } from "./config";

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

/** Resolve the on-disk directory to scan for one journal's notes. */
async function resolveVaultDir(journal: JournalConfig): Promise<string> {
  if (journal.source.kind === "local") {
    console.log(`[${journal.name}] source: local (${journal.source.rootPath})`);
    return join(journal.source.rootPath, journal.name);
  }
  console.log(`[${journal.name}] source: github (${journal.source.repo}) → ${journal.source.cacheDir}`);
  return syncVault({
    repo: journal.source.repo,
    token: journal.source.token,
    cacheDir: journal.source.cacheDir,
    subdir: journal.name,
  });
}

/** Sync, find "on this day" notes, and email one journal's recipient. */
async function runJournal(journal: JournalConfig, today: DateParts, delivery: Delivery): Promise<void> {
  const vaultDir = await resolveVaultDir(journal);
  const notes = await loadNotes(vaultDir);
  console.log(`[${journal.name}] loaded ${notes.length} note(s).`);

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

  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(2000, today.month - 1, today.day)));

  if (matches.length === 0) {
    console.log(`[${journal.name}] nothing on this day — skipping email.`);
    return;
  }

  const html = renderEmail(matches, {
    vaultName: journal.name,
    dayLabel,
    redirectBase: journal.redirectBase,
  });

  await sendEmail({
    apiKey: delivery.apiKey,
    from: delivery.from,
    to: journal.to,
    subject: `On this day · ${dayLabel} · ${matches.length} note${matches.length > 1 ? "s" : ""}`,
    html,
  });

  console.log(`[${journal.name}] sent ${matches.length} note(s) for ${dayLabel} → ${journal.to}.`);
}

async function main() {
  const { journals, delivery } = loadConfig();
  const today = londonToday();
  console.log(`Processing ${journals.length} journal(s).`);

  // Run journals independently: one journal failing (bad repo, sync error)
  // must not stop the others from being delivered. Collect failures and
  // exit non-zero at the end so the scheduled run is still marked failed.
  const failures: Error[] = [];
  for (const journal of journals) {
    try {
      await runJournal(journal, today, delivery);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(`[${journal.name}] failed:`);
      console.error(e.stack ?? e.message);
      failures.push(e);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${journals.length} journal(s) failed.`);
  }
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
