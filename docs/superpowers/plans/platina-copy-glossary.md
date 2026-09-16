# Platina Copy Glossary and Transition Checklist

**Date:** 2026-09-16
**Slice:** 0, workstream W0.7
**Governing plan:** [2026-09-11-platina-waters-realtime-full-suite.md](./2026-09-11-platina-waters-realtime-full-suite.md) (+ 2026-09-15 addendum)

One page of business language that every later slice's copy work cites, plus
the checklist every old-route transition follows. Owner approval of this page
is part of the Slice 0 done-when gate.

## 1. Internal term → business language (primary UI)

| Internal / technical | Primary-UI business language |
|---|---|
| Gate 1 (`declare`) | Brand standard confirmed |
| Gate 2 (`confirm`) | Audit scope approved |
| Gate 3 (`approve`) | Direction approved |
| Gate 4 (`publish`) | Ready for external execution |
| Plane A | Approved evidence |
| Plane B | Public observation |
| Plane C | Derived market hypothesis |

Technical terms (gate names, plane labels, generation, agreement state,
confidence) remain available only inside the expandable audit/provenance
panel, never in primary copy.

## 2. Banned in primary UI

Verified present today and scheduled for Slice 1 removal:

- S1–S12 stage codes (current eyebrows, e.g. `brand/page.tsx` "S1 · gate 1").
- Plane A/B/C labels.
- Gate 1–4 labels.
- Generation counters ("gen 0").
- Raw confidence decimals and agreement-state jargon.
- "Brain" as a user-facing store name.
- Instagram, reels, hashtags, comments, engagement rate, and
  social-publishing terms.
- "Open InstaMedia" and any `/w/*` link (`src/components/platina/sidebar.tsx`).
- Any copy implying cross-division coverage the data model does not provide
  (R3).
- Any "real-time" phrasing that promises instant external-world detection.

## 3. Old-route transition checklist template

One instance per route from the [route inventory](./platina-route-inventory.md),
executed at the route's transition slice:

- [ ] Demonstrate the old route's behavior to the owner.
- [ ] Demonstrate the new replacement.
- [ ] Confirm data/history parity between old and new.
- [ ] Record the decision: keep / merge / redirect / remove, with date and
  approver.
- [ ] Place the temporary "Moved to…" notice on the old page.
- [ ] Add the redirect and update E2E coverage; both green.
- [ ] Delete the old component only after redirects and E2E are green and
  Owner checkpoint B explicitly approves the deletion.

## Open question (not a Slice 0 task)

Whether Slice 1 adds a copy-lint style test that enforces the banned list
mechanically. Recorded here per the task plan; decide at Slice 1.
