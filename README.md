# On This Day

A tiny scheduled job that emails you the notes from your [Obsidian](https://obsidian.md)
vault that were written **on this day** in previous years — a "memories" feed for
your journal.

Each morning it scans your vault, finds every note dated to today's month and day
in an earlier year, and sends a clean HTML digest. Note links open straight back
into Obsidian via `obsidian://` deep links, and embedded photos/videos are shown
as counts ("📷 2 photos · 🎥 1 video") so you know which notes are worth opening.

Built with [Bun](https://bun.sh) and [TypeScript](https://www.typescriptlang.org/).
Email delivery uses [Resend](https://resend.com).

## How it works

1. **Load notes.** Every `.md` file in your vault is read (dotfolders like
   `.obsidian` are skipped).
2. **Resolve each note's date**, in order of preference:
   1. an ISO date in the filename (daily notes like `2024-06-13.md`),
   2. a `date:` or `created:` field in YAML frontmatter,
   3. the file's first git-commit date (only when the vault is a git repo).
3. **Match today.** Keep notes whose month + day equal today's, from any earlier
   year, most recent first.
4. **Render & send** an HTML email. If nothing matches, no email is sent.

## Vault sources

You point the job at your vault in one of two ways. Choose **one**.

**Local mode** — read a vault folder already on the machine. Best for running on
your own computer.

```bash
VAULT_ROOT_PATH="/absolute/path/to/folder/containing/your/vault"
```

**GitHub mode** — clone a private vault repo into a local cache directory. Best
for running in the cloud (e.g. Railway), which has no local copy of your vault.

```bash
GITHUB_REPO="owner/repo"
GITHUB_TOKEN="github_pat_..."   # a token with read-only Contents access
VAULT_CACHE_DIR="./.vault-cache" # optional; where the clone is kept
```

### Creating the GitHub token

`GITHUB_TOKEN` only needs read access to the contents of your vault repo. Create a
**fine-grained personal access token** scoped to just that repo:

1. Go to **GitHub → Settings → Developer settings → Fine-grained tokens**, or
   open <https://github.com/settings/personal-access-tokens/new>.
2. Give it a name (e.g. `obsidian-on-this-day`) and an expiry.
3. Under **Repository access**, choose **Only select repositories** and pick your
   vault repo.
4. Under **Permissions → Repository permissions**, set **Contents** to
   **Read-only**. Leave everything else as **No access**.
5. Click **Generate token** and copy the `github_pat_...` value into
   `GITHUB_TOKEN`. You won't be able to see it again, so store it safely.

> Prefer fine-grained tokens over classic ones — they can be locked to a single
> repo with read-only access, which is all this job needs.

> Note: git-commit-date resolution (step 2.3 above) only works when the vault is
> a git repository — i.e. in GitHub mode, or in local mode if your vault folder
> is itself a git repo. Notes with no date from any source are skipped.

## Configuration

All configuration is via environment variables. Copy the example file and fill it
in:

```bash
cp .env.example .env
```

| Variable          | Required | Description                                                                 |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| `VAULT_NAME`      | yes      | The vault folder inside your source, and the Obsidian vault name for deep links. |
| `VAULT_ROOT_PATH` | local    | Absolute path to the folder containing your vault (local mode).             |
| `GITHUB_REPO`     | github   | `owner/repo` of the vault repo to clone (GitHub mode).                      |
| `GITHUB_TOKEN`    | github   | Personal access token with read-only Contents scope (GitHub mode).         |
| `VAULT_CACHE_DIR` | no       | Where the GitHub clone is cached. Defaults to `./.vault-cache`.             |
| `RESEND_API_KEY`  | yes      | Your Resend API key.                                                        |
| `EMAIL_FROM`      | yes      | Sender, e.g. `On This Day <onthisday@yourdomain.com>`. Domain must be verified in Resend. |
| `EMAIL_TO`        | yes      | Recipient address.                                                          |

`VAULT_NAME` is also used as the title shown at the top of the email.

## Usage

Install dependencies once:

```bash
bun install
```

**Send today's digest** (this is what the scheduled job runs):

```bash
bun run start
```

**Preview the email without sending.** Renders the HTML to
`.context/email-preview.html` and prints the subject and matched years — handy
for tweaking the design. Pass a date to preview a different day; omit it for
today.

```bash
bun run preview            # today
bun run preview 12-25      # 25 December, any year
bun run preview 2024-12-25 # same — the year is ignored for matching
```

Open the result in a browser:

```bash
open .context/email-preview.html      # macOS
xdg-open .context/email-preview.html  # Linux
```

## Deployment (Railway)

The included `Dockerfile` and `railway.toml` configure a run-to-completion cron
job on [Railway](https://railway.app):

- The container runs `bun run src/index.ts` once and exits.
- `railway.toml` schedules it daily and sets `restartPolicyType = "NEVER"` — a
  cron service must exit and stay exited, or the next scheduled run is skipped.
- The default schedule is `0 7 * * *` (07:00 **UTC**). Edit `cronSchedule` in
  `railway.toml` to change it.

Set the environment variables above in your Railway project. For the cloud, use
**GitHub mode** so the vault is cloned at runtime.

> The app maps "today" to the `Europe/London` timezone (see `londonToday()` in
> `src/index.ts`). Adjust that if you want a different zone.

## Project layout

```
src/
  index.ts    entry point: resolve today, match notes, send email
  vault.ts    load notes, parse frontmatter, resolve dates, count media
  email.ts    render the HTML digest and send via Resend
  preview.ts  render the email to a local file without sending
```

## License

MIT
