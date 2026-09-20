# Platina AI OS

Agency operating system for social content: each client gets an isolated
workspace with a baseline-driven content engine (ingestion -> KB -> Brand DNA ->
ideation -> studio/compliance -> calendar -> learning loop), plus Platina
(audits, findings, solutions, outcomes) and a campaign planner that turns a
two-line brief into a roadmap and learns from the results you record. See
`CLAUDE.md` for the build constitution (stack lock, isolation rules, scope) and
`backend-rev.md` for the backend architecture.

## Stack

- Next.js 14 App Router · TypeScript · Tailwind + shadcn/ui
- Drizzle ORM + Supabase Postgres (`postgres-js`, transaction pooler)
- NextAuth v5 (Google OAuth + Resend magic links)
- Vitest · GitHub Actions CI · Vercel

## Design tokens

| Token | Value |
|---|---|
| Headlines | Playfair Display (`font-display`) |
| Body | Inter (`font-sans`) |
| Labels / data | IBM Plex Mono (`font-mono`, `.label-mono`) |
| Accent teal (primary) | `#0d9488` |
| Accent purple | `#8b5cf6` |
| Accent amber | `#f59e0b` |
| Success | `#10b981` |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values (see below)
npm run db:migrate           # applies drizzle/ migrations to DATABASE_URL
npm run dev
```

Required env (see `.env.example` for details):

- `DATABASE_URL` — Supabase transaction-pooler connection string
- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth web client
- `AUTH_RESEND_KEY` / `EMAIL_FROM` — Resend, for magic-link login

Without `DATABASE_URL` the app still builds and renders the landing/login
pages; DB-backed flows show a "setup required" notice.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` / `test` | CI trio (also runs on GitHub Actions) |
| `npm run db:generate` | Generate SQL migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |

## Tenancy model

`org → workspace → membership`. Every tenant-data table carries an indexed
`workspace_id` (enforced by `src/db/schema.test.ts`); workspace-scoped query
helpers in `src/db/queries/` take `workspaceId` as their first argument, and
server actions verify membership before touching rows.
