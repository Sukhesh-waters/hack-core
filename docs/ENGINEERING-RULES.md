# ENGINEERING-RULES.md

**Audience:** any agent or engineer picking up this codebase cold.
**Authority:** `CLAUDE.md` is the constitution. This file expands it with
rules and footguns *earned the hard way* during the W/P/S phases. Where the
two disagree, `CLAUDE.md` wins.

Read this before writing a line. Most of it exists because something here
already shipped a bug that typechecked clean and passed the full suite.

---

## 1. Non-negotiable invariants

These are checked in review. A diff that breaks one does not merge.

| Rule | What it means in practice |
|---|---|
| **Workspace isolation** | `eq(x.workspaceId, workspaceId)` in every read **and** every UPDATE/DELETE WHERE. Child tables carry their own `workspace_id` — never inherit isolation through a join or a parent id. |
| **Ownership is never implied by an id** | A `templateId`/`runId`/`clientId`/`assigneeId` from a form is an untrusted string. Re-check it belongs to this workspace before any write that uses it. |
| **Two-layer separation** | Pattern/public (Apify) rows never reach scoring, ideation, reports, or SOP suggestions. Never cite both first-party and public in one explanation. |
| **AI only through the router** | No provider SDK outside `src/lib/ai/`. Every call wrapped in `runWithAiCost`. |
| **Min-N gate** | Never render a direction/magnitude score below the baseline threshold. Show "insufficient baseline". |
| **Additive migrations only** | No `DROP`, no `RENAME`, no `NOT NULL` without a default. `ALTER TYPE ... ADD VALUE` is fine. |
| **No unbounded queries** | Every read has an explicit `.limit()`. Aggregates that return one row are the only exception, and say so in a comment. |
| **No `any`** | Derive types from the schema (`(typeof someEnum.enumValues)[number]`) rather than restating them. |
| **Static Tailwind** | JIT scans source text. Class strings must be written out in full. Never build a colour or size by interpolation. Dynamic runtime values (progress widths, data-driven swatches) may use `style={}`. |
| **Capability, not membership, for anything that changes the process** | `requireCapability(...)`, not `requireMembership(...)`, on every mutation that edits a workflow, a template, or decides a gate. |

### The merge gate, every slice

```bash
npx tsc --noEmit          # must be silent
npx vitest run            # must be green
npx eslint src            # must be clean
npm run build             # only when `next dev` is NOT running (see §3)
```

**Plus: drive it in a browser.** This is not optional and not a formality —
see §2.

---

## 2. Why "it typechecks and tests pass" is not done

Four defects in the W/P/S phases passed `tsc` **and** the full suite and
were only found by loading the page. This is the single most reliable
lesson from the whole build.

Real examples, all shipped-then-caught:

1. **Uncontrolled forms don't reset.** A server action + `revalidatePath`
   *re-renders*, it does not *remount*. Uncontrolled inputs keep whatever
   was last typed. The add-step form silently carried the previous step's
   gate, offset and dependencies into the next step. Fix: actions return
   `{ savedAt: number }` so success is distinguishable from "never
   submitted", and the client resets on it.
2. **A row created in the wrong dimension is invisible.** Materialised
   content set the legacy `productionStage` but not `workflow_state_id`,
   which the Production board renders from. The draft existed and appeared
   nowhere.
3. **A hand-written union drifted from its enum.** `ActivitySubjectType`
   restated `activity_subject`; adding a value to the schema left it
   unassignable in the helper while every file still typechecked. Fix:
   derive from the enum.
4. **A gate with nothing to check can never close.** A compliance-gated
   step with `creates: none` had no draft to audit, so the run would stall
   forever while looking merely slow.

**Rule:** before claiming a slice is done, load the affected pages, perform
the actual user action, and read the resulting state. Record what you saw
in the commit message.

---

## 3. Footguns (each one cost real time)

### Dev server vs. build
Running `npm run build` while `next dev` is live corrupts `.next` and
produces errors indistinguishable from real bugs
(`Cannot find module './vendor-chunks/next.js'`, `X is not defined`).

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs -r kill -9
rm -rf .next
nohup npm run dev > /tmp/dev.log 2>&1 &
```

### Stale HMR errors look like real errors
After editing a client component, the console may hold a **compile error
from mid-edit**. Always `console --clear` then `reload` before believing a
console error. If it's gone on a fresh load, it was HMR.

### Nav entries need three edits, not one
Adding a slug to `src/lib/nav.ts` requires:
1. the entry in `NAV_SECTIONS`
2. a matching icon in `ICONS` in `src/components/workspace-nav.tsx`
3. the count in `src/lib/nav.test.ts` (**two** assertions: length and
   unique-slug count)

`ICONS` now has a `?? Circle` fallback, so a miss no longer blanks the app
— but the entry should still be added deliberately.

### Browser-automation gotchas
- `$B js` evaluates an **expression**. Function declarations throw. Use an
  IIFE written to a file and run it with `$B eval <file>`.
- Matching a card by full `textContent` picks the **wrong** card when one
  card quotes another's title ("Waiting on: X"). Match the title element.
- Multiple forms on a page often share input names (`name`, `stepId`).
  Scope the selector: `form:has(input[name="anchorDate"]) input[name="name"]`.
- The dev-bypass session does not survive a browse-daemon restart. Re-auth.

### Zod v4
`z.coerce.date({ error: "..." })`, **not** `errorMap`.

---

## 4. Patterns this codebase uses deliberately

Follow these; don't invent parallel mechanisms.

### Guarded writes (race safety)
Put the expected current state in the `WHERE` and check `.returning()`:

```ts
const rows = await tx.update(table)
  .set({ status: to })
  .where(and(
    eq(table.workspaceId, workspaceId),
    eq(table.id, id),
    inArray(table.status, [...expectFrom]),   // <- the guard
  ))
  .returning({ id: table.id });

if (rows.length === 0) return { ok: false, error: "That already moved." };
```

Two people clicking the same button get one write and one honest error, not
two applications. Used by `advanceStageQuery`, the workflow engine's
transitions, and `moveRunStep`.

### Cascades belong in the same transaction as their cause
Unblocking dependents and marking a run complete happen inside the same
transaction as the status change that caused them. Splitting them lets a
completed step leave dependents blocked forever if the second write fails.

### Pure core, thin I/O shell
Decision logic lives in `src/lib/**` as pure functions with no DB import,
and is tested exhaustively there. Queries and actions do I/O and call in.
See `lib/sop/instantiate.ts`, `lib/sop/risk.ts`, `lib/workflow/engine.ts`.

### Registries over scattered literals
A type's meaning (label, hint, validation) lives in one registry that the
UI and the writer both read: `lib/custom-fields.ts`, `lib/sop/template.ts`,
`lib/workflow/rules.ts`. Tests walk the enum to prove every value has an
entry.

### Derive types from the schema
```ts
export type Foo = (typeof fooEnum.enumValues)[number];   // yes
export type Foo = "a" | "b" | "c";                        // no — it drifts
```

### Refusals name the action, not the role
"Only an admin can change this workspace's workflow." — not
"member role lacks workflow.edit".

---

## 5. Product principles that constrain code

These are decisions already made. Don't quietly reverse them.

- **Nothing closes because someone asserted it.** A gated step closes
  because the gate's real mechanism fired (an approval by someone with
  `approval.decide`, a passing compliance run). Manual completion of a
  gated step is refused.
- **Dates never move silently.** A late step flags its dependents and
  offers an explicit reschedule. The slipped step and any closed step keep
  their dates — those are evidence and history.
- **Skip is not Done.** Skipping records that work will never happen, so
  completion metrics stay honest. It still unblocks dependents.
- **A run is a snapshot.** Editing a template must never rewrite work
  already underway.
- **Roles resolve to roles, not people.** A template asking for "an admin"
  does not auto-pick one; it shows "Needs an admin" and a human chooses.
- **Blocked must say what it waits on.** "Blocked" with no reason is the
  most common way a process stalls with nobody knowing whose move it is.
- **Create on demand, not up front.** A 14-step template must not dump 14
  empty drafts into the workspace when someone starts a run.

---

## 6. Commit and review conventions

- One slice = one branch = one reviewable diff.
- Commit messages state **what was verified in a browser**, not just what
  was written. Name the defect a change prevents where relevant.
- Record Minor findings as you go; batch-fix them rather than one fixer per
  finding.
- Update `.superpowers/sdd/progress.md` when a slice lands. Conversation
  memory does not survive compaction; the ledger is the recovery map.

---

## 7. Current repo facts (2026-08-01)

| Fact | Value |
|---|---|
| Tests | 1086 passing, 1 skipped |
| Migrations applied | through `0038` |
| Branch | `slice/s1-content-model`, 62 commits ahead of `main`, **no PR** |
| Deployed | **never** |
| Node/dev | `npm run dev` on :3000; dev-bypass login enabled |

Live fixture for browser checks:
```
workspace d89220ec-6e93-4cbf-9976-9e078fe11918
template  ea96af47-9c55-4660-b71e-962c68c169e6  "Campaign launch" (3 steps)
```
