# To-do

A personal to-do list that pulls together **Pipedrive activities**, **Slack List items** and tasks you add yourself, with two-way sync so you only manage your list here.

- Views: **Today** (overdue, today, in progress), **Upcoming**, **By source**, **Board** (To do / In progress / Done)
- Search across titles, notes, deals, people and organisations
- Pipedrive context: deal, organisation, contact (email/phone) and links back to Pipedrive
- Installable on your phone (PWA); Google sign-in locked to one email

## How sync works

| In the app | Pipedrive | Slack List |
|---|---|---|
| Tick / mark Done | activity marked done | Completed checkbox ticked |
| Edit title, notes, due date | activity updated | item updated |
| Edit due time | updated (converted to UTC) | not synced (Slack dates have no time) |
| Delete | activity deleted | item deleted |
| Move to *In progress* | app only | app only |
| New task | stays in the app | stays in the app |

- Edits are pushed immediately; a full sync runs every 5 minutes (and when you open the app).
- If a task changed in both places, the **most recent edit wins**.
- Only **open activities assigned to you** come in from Pipedrive. Things completed or deleted in the source are marked done / removed in the app.
- Completed tasks stay visible (Board → Done, search) for 14 days.

## Local development

Requires Node 22+ and Postgres.

```bash
cp .env.example .env.local      # fill in what you have; AUTH_DISABLED=true skips sign-in locally
npm install
npm run db:migrate
npm run dev
```

Tests: `npm test` (unit). Integration tests against a real database: `TEST_DATABASE_URL=postgres://… npm test`.

## Connecting the sources

### Pipedrive
1. Pipedrive → avatar → **Personal preferences → API** → copy your token into `PIPEDRIVE_API_TOKEN`.
2. `PIPEDRIVE_COMPANY_DOMAIN` is the part before `.pipedrive.com`; `PIPEDRIVE_USER_ID` is your user ID.

### Slack List
1. Create an app at <https://api.slack.com/apps> → *From scratch* → your workspace.
2. **OAuth & Permissions → User Token Scopes**: add `lists:read` and `lists:write`.
3. **Install to workspace** (may need admin approval) and copy the **User OAuth Token** (`xoxp-…`) into `SLACK_USER_TOKEN`.
4. Open your List in Slack → *Copy link*; the ID starting with `F` is `SLACK_LIST_ID`.
5. Columns are auto-detected (primary column = title, completed checkbox, due date, a text column named Notes/Description). Override with `SLACK_COL_*` if needed.

### Google sign-in
1. Google Cloud Console → **APIs & Services → Credentials → OAuth client ID** (Web application).
2. Authorised redirect URI: `https://<your-domain>/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local).
3. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (`npx auth secret`) and `ALLOWED_EMAIL`.

## Deploying (Vercel + Neon)

1. Create a Postgres database on [Neon](https://neon.tech) and set `DATABASE_URL`.
2. Import the repo into Vercel, add all variables from `.env.example` (without `AUTH_DISABLED`), and set a random `CRON_SECRET`.
3. Run migrations once: `DATABASE_URL=… npm run db:migrate`.
4. Background sync: `vercel.json` schedules `/api/sync` every 5 minutes. **Vercel's Hobby plan doesn't allow cron jobs this frequent** — on Hobby, remove `vercel.json` and use a free scheduler such as cron-job.org to call `GET https://<your-domain>/api/sync` with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes. The app also syncs whenever it's open.

## Project layout

```
src/
  app/            pages, server actions, /api/sync, /api/auth
  components/     TaskApp (views, board, search), TaskEditor
  db/             Drizzle schema + client
  lib/sync/       reconcile (pure), engine, pipedrive, slack providers
  lib/            tasks service, time (timezone) and notes (HTML↔text) helpers
drizzle/          SQL migrations
```
