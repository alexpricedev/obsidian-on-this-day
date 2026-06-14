import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { renderEmail } from "./email";
import { loadNotes, type DateParts, type Note } from "./vault";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

/** Today's date in Europe/London, or an override from argv (YYYY-MM-DD / MM-DD). */
function targetDate(): DateParts {
  const arg = process.argv[2];
  if (arg) {
    const m = arg.match(/(?:(\d{4})-)?(\d{2})-(\d{2})/);
    if (m) {
      return { year: +(m[1] ?? 9999), month: +m[2], day: +m[3] };
    }
  }
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
  const vaultDir = join(env("VAULT_ROOT_PATH"), vaultName);

  const today = targetDate();
  const notes = await loadNotes(vaultDir);

  const matches = notes
    .filter(
      (n): n is Note & { date: DateParts } =>
        n.date !== null &&
        n.date.month === today.month &&
        n.date.day === today.day &&
        n.date.year < today.year,
    )
    .sort((a, b) => b.date.year - a.date.year);

  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(2000, today.month - 1, today.day)));

  if (matches.length === 0) {
    console.log(`No notes on ${dayLabel} (prior years). Nothing to preview.`);
    return;
  }

  const html = renderEmail(matches, {
    vaultName,
    dayLabel,
    redirectBase: process.env.REDIRECT_BASE_URL,
  });
  const out = ".context/email-preview.html";
  await writeFile(out, html, "utf8");

  console.log(`Subject: On this day · ${dayLabel} · ${matches.length} note${matches.length > 1 ? "s" : ""}`);
  console.log(`Matched years: ${matches.map((m) => m.date.year).join(", ")}`);
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
