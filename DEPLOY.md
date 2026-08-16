# ☁️ Deployment Guide — Supabase + Cloudflare Pages + Render

This guide explains how the three services work together and how to deploy
each one.

## Architecture

```
┌─────────────────────┐        ┌──────────────────────┐
│  Cloudflare Pages   │        │  Render (Python)     │
│  (static frontend)  │──API──▶│  AI / scoring /      │
│  HTML/CSS/JS        │        │  transcription       │
└─────────┬───────────┘        │  (holds API key)     │
          │                    └──────────────────────┘
          │ supabase-js (anon key)
          ▼
┌─────────────────────┐
│  Supabase           │
│  Postgres + Auth    │  ← secure, centralized history
│  (Row Level Security)│
└─────────────────────┘
```

- **Cloudflare Pages** hosts the static frontend (fast global CDN, free SSL).
  It *cannot* run Python, so the AI backend stays on **Render**.
- **Supabase** stores the profile and test history securely (Postgres + RLS).
- **Render** runs the Python backend (unchanged) — AI calls, scoring, transcription,
  and keeps your `OPENAI_API_KEY` server-side.

---

## 1. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → create a **free project**.
2. Open **SQL Editor** → paste the contents of `supabase/schema.sql` → **Run**.
   (This creates the `profiles` + `test_results` tables with Row Level Security.)
3. To allow **anonymous sign-in** (optional, no-email login):
   **Authentication → Providers → Anonymous** → enable it.
4. To use **email + password** without email confirmation:
   **Authentication → Providers → Email** → turn **OFF** "Confirm email".
5. Copy your connection values from **Project Settings → API**:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public key** (safe to use in the browser — RLS protects the data)

> ⚠️ Never use the `service_role` key in the frontend — only the `anon` key.

---

## 2. Connect the app to Supabase (two ways)

**Option A — in-app Settings (easiest, no redeploy):**
Open the app → **👤** → **Settings**, paste the Supabase URL and anon key, and
Save. The values persist in localStorage.

**Option B — edit `frontend/config.js`** before deploying:
```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcd1234.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi…",
  API_BASE: "https://your-app.onrender.com",
};
```

---

## 3. Deploy the frontend to Cloudflare Pages

The frontend has **no build step** (vanilla HTML/CSS/JS), so you deploy the
`frontend/` folder directly.

**Option A — via the Cloudflare dashboard:**
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create → Pages** → **Direct Upload**.
2. Drag the `frontend/` folder (or connect your GitHub repo and set:
   - Build command: *(none)*
   - Build output directory: `frontend`
3. Deploy. You'll get a `*.pages.dev` URL.

**Option B — via Wrangler CLI:**
```bash
npm i -g wrangler
wrangler pages deploy frontend --project-name ielts-ai
```

---

## 4. Configure the backend URL + CORS

Since the frontend now lives on `*.pages.dev` (or your custom domain) but the
API lives on Render, you must tell the frontend where the API is:

- In-app Settings → **Backend API URL** → `https://your-app.onrender.com`
- Or set `API_BASE` in `frontend/config.js`.

The backend already allows cross-origin requests (CORS). Optionally restrict
it by setting the `CORS_ORIGINS` environment variable on Render to your
pages.dev domain, e.g. `CORS_ORIGINS=https://ielts-ai.pages.dev`.

---

## 5. (Already done) Render backend

Your Python backend is already deployed on Render. No changes are needed —
it keeps serving `/api/*` and holding the AI key. If you redeploy, remember
the env vars: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_MODEL`.

---

## Optional: custom domain

1. Cloudflare Pages → your project → **Custom domains** → add e.g. `ielts.yourname.com`.
2. Point the domain's DNS at Cloudflare (it does this automatically).

---

## Security summary

| Secret                  | Where it lives          | In the browser? |
|-------------------------|-------------------------|-----------------|
| `OPENAI_API_KEY`        | Render (env var)        | ❌ never        |
| Supabase `anon` key     | `config.js` / settings  | ✅ (by design)  |
| Supabase `service_role` | unused in this app      | ❌ never        |

Data in Supabase is protected by **Row Level Security**: each signed-in user
can only read/write their own `profiles` and `test_results` rows.
