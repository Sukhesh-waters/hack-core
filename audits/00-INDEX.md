# Feature Audit Index (2026-07-14)

Full-coverage logic/flow audit across every workspace feature, run as 7 parallel
domain audits so the work survives a dropped session. Each file below is written
directly to disk by its own agent — check off as each lands.

| # | Domain | Pages | File | Status |
|---|---|---|---|---|
| 01 | Operate core | overview, hub, plan | [01-operate-core.md](01-operate-core.md) | pending |
| 02 | Production spine | production, approvals, calendar | [02-production-spine.md](02-production-spine.md) | pending |
| 03 | Intelligence | brand-gene, ideation, studio | [03-intelligence.md](03-intelligence.md) | pending |
| 04 | Knowledge & patterns | kb, patterns, rules | [04-knowledge-patterns.md](04-knowledge-patterns.md) | pending |
| 05 | Business | drift, reports, ads, cockpit | [05-business.md](05-business.md) | pending |
| 06 | Infrastructure | accounts, clients, analytics | [06-infrastructure.md](06-infrastructure.md) | pending |
| 07 | Cross-cutting | ask assistant, auth/middleware, ai router, workspace isolation | [07-cross-cutting.md](07-cross-cutting.md) | pending |
| 08 | Counterattack plan | fixes for findings 01–07, re-verified vs codebase 2026-07-18 | [08-COUNTERATTACK.md](08-COUNTERATTACK.md) | ✅ implemented (346 tests green) |

Each domain file follows the same structure: per-page walk of every user action
→ server action/query → DB write, flagging logic flaws, broken flows, dead ends,
and workspace-isolation gaps, each rated Critical/High/Medium/Low with file:line
evidence.
