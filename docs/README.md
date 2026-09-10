# docs/

Handoff documentation for the InstaMedia AI SOP platform build.

**Start here if you are picking this up cold**, in this order:

| # | File | What it is |
|---|---|---|
| 1 | [ENGINEERING-RULES.md](ENGINEERING-RULES.md) | Binding rules, invariants, and footguns that already cost real time. Read before writing code. |
| 2 | [ARCHITECTURE-SOP.md](ARCHITECTURE-SOP.md) | What exists today: schema, modules, invariants, and why each is shaped that way. |
| 3 | [HANDOFF-SOP-REMAINING.md](HANDOFF-SOP-REMAINING.md) | The executable plan for the six remaining slices (D1–D3, A1–A3). |
| 4 | [ENHANCEMENTS.md](ENHANCEMENTS.md) | Known gaps outside the plan, ranked by why they matter. |

Also relevant, outside this folder:

- [`../CLAUDE.md`](../CLAUDE.md) — the constitution. Outranks everything here.
- [`../PLAN-SOP-PLATFORM.md`](../PLAN-SOP-PLATFORM.md) — the original plan
  and its recorded decisions, with slice status.
- `../.superpowers/sdd/progress.md` — the ledger: commit SHAs per slice,
  live fixture ids, confirmed footguns. Trust it and `git log` over any
  recollection.

## State at time of writing (2026-08-01)

```
phases W1-W5, P1, S1-S5   COMPLETE
phases D1-D3, A1-A3       NOT STARTED
tests                     1086 passing, 1 skipped
migrations                applied through 0038
branch                    slice/s1-content-model, 62 commits ahead, no PR
deployed                  never
```
