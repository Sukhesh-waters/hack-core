# Core spine — manual test plan

Work through this top to bottom. Each step says what to do and what you should
see. If a step does not match, stop and note the step number — that is the bug
report.

## 0. Setup (once)

```bash
npm run dev:all      # app on :3000 AND the job runner (Inngest dev UI on :8288)
npx tsx scripts/seed-manual-test.ts
```

`npm run dev` alone starts only the app: it looks fine but **nothing scheduled ever runs**. The health page and
a red banner on the cockpit now say so, but `dev:all` avoids it. If you run the two separately, use `npm run dev:jobs`
for the second.

The seed prints your workspace id and links. It creates a fictional `[Demo]`
client (Northwind Coffee), one competitor (Bluebird Roasters), 5 validated
signals, 3 findings, 2 unprocessed documents, a past plan marked "worked", and
one live plan created *before* the evidence. Source specs are DRAFT, so nothing
is fetched and nothing is spent. Remove everything with
`npx tsx scripts/seed-manual-test.ts --clean`.

Below, `<ws>` is that workspace id and `<client>` the printed client id.

## 1. Is the loop healthy? — `/p/<ws>/admin/health`

| Check | Expect |
|---|---|
| Collection provider | Working |
| Database | Working, a few hundred ms at most |
| Background jobs | Working ("no approved sources yet…" is correct with the demo) |
| Click **Run the AI provider check** | fast tier: Groq, Working. quality tier: **Gemini `gemini-3.6-flash`, Working** (not "Degraded") |

## 1b. The failure you hit — job runner down

Start only `npm run dev` (no jobs). Then:
- Health → **Background jobs: Down**, "The Inngest dev server is not running… nothing will log an error", with the fix.
- Cockpit → red banner "Collection looks stopped…".
- Approving sources shows "The background job runner is not running, so nothing will be collected yet… the first pass begins by itself once it is up".
- Start `npm run dev:jobs`: the queued first pass is picked up automatically by the next 5-minute scheduler tick.

## 2. Add a real client — `/p/<ws>/start`  ⚠ spends Apify credits on approval

1. Enter a real client with a website (and an Instagram handle if you like). **Continue**.
2. You should see the main site pre-ticked, and paths marked **Found** / **Not found** / **Couldn't check**.
   If the site has a sitemap, expect real sections with page counts ("12 pages in the sitemap, last updated …").
3. Click **Suggest competitors** — a list appears (drafts). Untick or edit. Add one by hand in a blank row.
4. Note the line "reads up to N pages… daily limit is 40".
5. **Start collecting** — lands on the client page and the first pass starts immediately (no waiting for a scheduler tick).
   Each source shows live status: *Queued → Reading pages… → Analysing… → Done: N pages, M new*; the page refreshes itself.
   Within roughly 15–30 seconds the card **"What we understand about <client>"** fills in (summary, audience, tone, offers, claims, and how many of the client's own pages it came from).
   Competitor pages are analysed afterwards and appear as findings. Skip this step if you don't want to spend credits.

## 3. The client view — `/p/<ws>/brands` then the demo client

- Roster lists **[Demo] Northwind Coffee** with its competitor nested.
- Client page: 2 sources ("Waiting for approval"), 7 documents, findings listed, **Plan a campaign for [Demo] Northwind Coffee**.

## 4. Use case: a competitor moved — `/p/<ws>/findings`

1. On "[Demo] Bluebird: 48-hour roast guarantee" click **Plan a response to this move →**.
2. The plan page opens with that finding first. Click **Plan this response** (~10–15 s).
3. Expect: label "Response to “…48-hour roast guarantee”", **Evidence behind each phase** with source + collected date, no "Cold start" banner, review section either "passed" or real notes (never "could not be completed").

## 5. Use case: an event — `/p/<ws>/plan`

1. Event "Roast Day", a date ~30 days away, client Northwind. **Plan backwards from the date**.
2. Expect a phase whose day range covers day 30 (the roadmap timeline shows it).
3. Try yesterday's date → error "The event date must be in the future". Try 400 days out → "Plans run at most 180 days".

## 6. Use case: a client campaign

Client Northwind + a goal → **Plan for this client**. Expect evidence only about Bluebird/Northwind (client-scoped).
With a client that has *no* collected data, the roadmap should say "Nothing has been collected for this client…" (not silently cite other clients).

## 7. Real-time: the plan reacts to new evidence

1. Open **[Demo] Northwind holiday campaign** (linked from the seed output or the plan list, which shows "5 new signals").
2. Expect the amber panel: "5 new validated signals for [Demo] Northwind Coffee since this plan was written. Worth re-planning." with sample evidence.
3. Click **Re-plan with the new evidence**. Expect a new plan with **What changed**, a link "See the plan this revises"; open the old one → "A newer version exists". The old plan and its result are untouched.
4. The cockpit (`/p/<ws>`) shows the **Live plan** card with the same freshness sentence.

## 8. Real-time: new evidence arrives while you watch

1. Keep a plan page open. In the Inngest UI (`localhost:8288`) → **Send event**:
   name `platina/contradict.requested`, data `{"workspaceId":"<ws>"}`.
2. The two unprocessed demo documents are analysed (uses Groq/Gemini). New findings appear on `/p/<ws>/findings`.
3. The header pill says **Live** (Realtime connected) or **Polling**; the plan page's count updates within ~20 s either way. It never claims "Live" without a connection.

## 9. Honesty checks

- Cockpit with jobs stopped **and** approved sources: banner "Collection looks stopped…" with a link to the fix (needs a real approved source; ~15 min).
- Admin → set **Daily collection limit** to 1, then let a real source tick: Audits shows a *degraded* run "daily collection cap reached", once per day, and the cockpit banner says the pause resumes at 00:00 UTC.
- Any page with `?error=` shows a plain sentence, never a stack trace.

## 10. Already-known limits (not bugs)

- **Gemini free tier is 20 requests per day per model on this key.** Analysis debates use Gemini as an independent challenger; once it is used up they fall back to Groq and are recorded as *qualified* with a "not independent" note (never "agreed"). The cockpit banner says "daily free-tier quota is used up". Resets daily; enabling billing removes it.
- Findings from competitor pages are still fairly generic (a first scrape is a baseline, and low-signal pages like "Contact sales" are analysed too).

- The planner reads the client profile (how the client speaks, what it offers, what it claims) as context for client-scoped plans. It still does not read the workspace-level declared brand standard.
- "New signals" counts validated signals for the client since the plan — not how relevant each is.
- The "AI provider fallback" banner only reflects calls made inside a workspace context (planner, analysis, stages).
- Social actor field names (Instagram/TikTok) are verified against fixtures only; the first real `social_posts` run confirms them.
