import type { DateParts, MediaCounts, Note } from "./vault";

type DatedNote = Note & { date: DateParts };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function obsidianUri(vaultName: string, relPath: string): string {
  const file = relPath.replace(/\.md$/, "");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

function excerpt(body: string, len = 240): string {
  const text = body
    .replace(/^#.*$/gm, "") // headings
    .replace(/!\[\[[^\]]*\]\]/g, "") // obsidian embeds ![[file]]
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // markdown embeds ![](file)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a) // wikilinks -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > len ? `${text.slice(0, len).trimEnd()}…` : text;
}

/** "📷 2 photos · 🎥 1 video" placeholder, or "" when the note has no media. */
function mediaLine(media: MediaCounts): string {
  const parts: string[] = [];
  if (media.images) parts.push(`📷 ${media.images} photo${media.images > 1 ? "s" : ""}`);
  if (media.videos) parts.push(`🎥 ${media.videos} video${media.videos > 1 ? "s" : ""}`);
  if (parts.length === 0) return "";
  return `<div style="margin:10px 0 0;font-size:13px;color:#8a8a8a;font-weight:600;">${parts.join(
    "&nbsp;&nbsp;·&nbsp;&nbsp;",
  )}<span style="font-weight:400;color:#b0b0b0;"> — open to view</span></div>`;
}

export function renderEmail(
  notes: DatedNote[],
  opts: { vaultName: string; dayLabel: string },
): string {
  const cards = notes
    .map((n) => {
      const uri = obsidianUri(opts.vaultName, n.relPath);
      const ex = excerpt(n.body);
      return `
      <tr><td style="padding:0 0 16px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #ececec;border-radius:12px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#9a9a9a;font-weight:600;">${n.date.year}</div>
            <a href="${uri}" style="display:inline-block;margin:4px 0 6px;font-size:17px;line-height:1.3;color:#1a1a1a;text-decoration:none;font-weight:600;">${escapeHtml(n.title)}</a>
            ${ex ? `<div style="font-size:14px;line-height:1.55;color:#555555;">${escapeHtml(ex)}</div>` : ""}
            ${mediaLine(n.media)}
          </td></tr>
        </table>
      </td></tr>`;
    })
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:0 4px 20px;">
          <div style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#9a9a9a;font-weight:600;">On this day</div>
          <div style="font-size:26px;font-weight:700;color:#1a1a1a;margin-top:2px;">${opts.dayLabel}</div>
        </td></tr>
        ${cards}
        <tr><td style="padding:8px 4px 0;font-size:12px;color:#b0b0b0;">From your Obsidian vault</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

export async function sendEmail(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
