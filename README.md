# Evenly

A website for splitting restaurant bills. Photograph the bill, say (or tap) who had what, and see
exactly what each person's share is, with taxes and charges shared fairly: GST only on food, VAT
only on drinks, service charge on everything. Copy each amount into Google Pay yourself.

**Live:** https://evenly-d0nl.onrender.com

- **Groups**: make a group with people's names, then save splits in it. Edit or delete them any time.
- **Accounts**: email and password. Sign-up and password resets are confirmed with a 6-digit code
  sent by email (no links). Every group is private to the account that made it.
- **Only the last 10 splits** per account are kept (most recently saved, across all groups). A
  database trigger deletes the oldest when an 11th is saved; change `offset 10` in the migration.
- Works on phones (camera upload, voice, sticky buttons) and desktops.

## Stack

| Part | What |
|---|---|
| `web/` | Next.js 16 (App Router, TypeScript). Pages are client components behind sign-in. |
| `web/app/api/scan` | Reads a bill photo with a chain of vision models (Gemini, then Groq Qwen). |
| `web/app/api/assign` | Whisper (speech) + an open-weight model on Groq turn "who had what" into assignments. |
| `web/lib/split.ts` | The split maths: exact fractions of paise, largest-remainder rounding, so shares always add up to the bill. Runs in the browser. |
| `supabase/` | Email/password auth and Postgres with row-level security. Evenly's tables (groups, people, splits) and functions live in their own `evenly` schema, since the project is shared with other apps. |

The AI routes only serve signed-in users, with a per-account daily limit kept in the database
(`AI_SCANS_PER_DAY`, `AI_ASSIGNS_PER_DAY`). Photos are shrunk to 2000 px in the browser before upload.

## Run it locally

Needs Node 22+ and Docker (for the local Supabase).

```powershell
npm install; npm --prefix web install; npm --prefix supabase/tests install
copy .env.example .env      # then fill in the AI keys
npm run db:start            # local Supabase; prints the API URL and Publishable key: put them in .env
npm run dev                 # http://localhost:3000
```

- Sign-up and password-reset codes land in **Mailpit** at http://127.0.0.1:54324, unless you
  turn on Gmail (below).
- To try it on your phone on the same Wi-Fi, open `http://<laptop-ip>:3000`. The camera and
  copy buttons need HTTPS on phones other than through `localhost`, so for real phone testing use
  the deployed site, or a tunnel (`ngrok http 3000`).
- `npm run db:reset` re-creates the local database from the migrations.

```powershell
npm test                    # split maths, AI chain + validation, and the database access rules (PGlite)
npm run lint
```

## Email with Gmail

1. Use a separate Gmail account for the app (e.g. `splitit.login@gmail.com`), so your own address
   isn't shown to users.
2. Turn on 2-Step Verification, then create an app password at https://myaccount.google.com/apppasswords.
3. **Hosted Supabase:** Dashboard > Authentication > Emails > SMTP Settings > enable custom SMTP:
   host `smtp.gmail.com`, port `587`, username = the Gmail address, password = the app password,
   sender email = the same address, sender name `Evenly`. Then raise Authentication > Rate
   Limits > emails per hour (Gmail allows about 500 a day).
4. **Email templates on hosted** live in the private `zayn0001/supabase-project` repo, which is
   shared by every app on this Supabase project. Its GitHub Action applies them on each push.
   Evenly tags its users at sign-up (`options.data.app = 'evenly'`) so those templates use
   Evenly's design. Locally, `supabase/templates/dev-code.html` is a plain stand-in.
5. **Local (optional):** put `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` in `.env` and uncomment the
   `[auth.email.smtp]` block in `supabase/config.toml`, then `npm run db:stop; npm run db:start`.

## Deploy (free): Supabase + Render

1. **Supabase** (already set up for the hosted project): fill the `POSTGRES_*` lines of `.env`
   from Dashboard > Connect > Session pooler (port 5432), then `npm run db:push`.
   - Authentication > Sign In / Providers > Email: on, "Confirm email" on, minimum password length 8.
   - Gmail SMTP (above).
2. **Render**: Dashboard > New > Blueprint, pick this repo. `render.yaml` creates one free web
   service (`web/`, Node 22, Singapore). Fill in the four secret values it asks for:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the hosted ones),
   `GEMINI_API_KEY`, `GROQ_API_KEY`. Optional: `AI_SCANS_PER_DAY`, `AI_ASSIGNS_PER_DAY`.
3. **Back in Supabase**, Authentication > URL Configuration: set the Site URL to the Render address
   (`https://evenly-d0nl.onrender.com`). Emails carry codes rather than links, so nothing else
   depends on it.

Render's free plan sleeps after 15 minutes without visitors; the first visit after that takes
up to a minute while it wakes. `NEXT_PUBLIC_*` values are built into the site, so redeploy after
changing them.
