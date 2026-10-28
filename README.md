# NxtWave AI Workshop Growth Engine

React + Vite frontend, Express API, Postgres (Supabase) storage. Includes **simulated seed data**, clearly labeled and separate from new demo registrations.

## Local run
Requires Node 20.19+ (or 22).
```bash
# API (in-memory mode if DATABASE_URL is empty - data resets on restart)
cd server && cp .env.example .env && npm install && npm run dev:env     # http://localhost:4000
# UI
cd client && npm install && npm run dev                                  # http://localhost:5173 (proxies /api)
```
Set `ADMIN_KEY` in `server/.env` to enable the registration CSV export. To use Postgres locally, put a connection string in `DATABASE_URL`.
Smoke test (API must be running): `cd server && BASE=http://localhost:4000 ADMIN_KEY=<your key> npm run smoke`

## Deploy (all free tiers)
1. **Supabase**: create a project -> Project Settings -> Database -> copy the **Session pooler** connection URI (replace `[YOUR-PASSWORD]`). Optional: run `server/schema.sql` in the SQL Editor (the API also applies it, idempotently, on startup).
2. **Render** (Web Service from your GitHub repo): Root Directory `server`, Build `npm install`, Start `npm start`. Env vars: `DATABASE_URL`, `ADMIN_KEY` (long random string), `CLIENT_ORIGIN` (your Vercel URL, no trailing slash; comma-separate several), `NODE_ENV=production`. Health check path: `/api/health`.
3. **Vercel**: Root Directory `client`, framework Vite, env var `VITE_API_URL` = your Render URL (no trailing slash). Deploy, then put the Vercel URL into Render's `CLIENT_ORIGIN` and redeploy/restart the API.
4. Verify: open the Vercel URL, footer should say `storage: postgres`; register, repeat the email (expect duplicate error), create an ambassador, register via its link, check leaderboard, export CSVs.

## Environment variables
| Where | Name | Purpose |
|---|---|---|
| server | `DATABASE_URL` | Postgres/Supabase URI. Empty = in-memory fallback |
| server | `ADMIN_KEY` | Required header `X-Admin-Key` for the registration CSV (contains emails). Unset = export disabled |
| server | `CLIENT_ORIGIN` | Allowed CORS origin(s), comma-separated |
| server | `SEED_DEMO_DATA` | `false` skips seeding an empty DB |
| client | `VITE_API_URL` | Backend base URL |

## Data & privacy
Collects only name, email, college, plus a consent timestamp. Public endpoints mask emails; full emails only via the admin-keyed CSV. Supabase RLS is enabled on both tables (no policies), so the Supabase public API cannot read them. Seed data uses reserved example domains and is fictional.

## Dashboard semantics
- **Measured**: registrations (split simulated vs. new), channel attribution, referral counts.
- **Plan (assumptions)**: target 500, 25% reach->visit, 20% visit->signup, per-channel targets; edit `PLAN` in `server/index.js`.
- Reach and visits are **not tracked** (no analytics integrated), so no measured funnel conversion is displayed.
