You are implementing the backend architecture for **Platina AI OS**, an LLM-driven Marketing OS with multi-agent orchestration.

The attached/defined architecture plan is the source of truth for architectural direction. Your task is to **inspect the existing codebase first, understand the current implementation and use cases, then incrementally refactor/build toward this architecture**.

Do not redesign the product.
Do not replace working functionality unnecessarily.
Do not introduce enterprise infrastructure prematurely.
Prefer the smallest implementation that correctly satisfies the existing use cases.

The target is:

**Lean prototype → clean architecture → clear production path.**

---

# 1. Core Architecture

Use this ownership model throughout the codebase:

```text
PostgreSQL = source of truth
pgvector   = semantic memory
Context    = determines what the model sees
Agents     = reasoning / proposal
Orchestrator = workflow control + writes
LLM Router = single model-call entry point
```

Responsibilities must remain separate.

### PostgreSQL

PostgreSQL owns exact operational information:

* clients
* brands
* brand configuration
* campaigns
* goals
* KPIs
* audiences
* social accounts
* posts
* scheduled content
* agent tasks
* workflow status
* approvals
* structured reasoning outputs
* relationships between entities

Anything requiring exact values, relationships, filtering, updates or transactional consistency belongs here.

Never embed structured application state.

Example:

```text
campaign_status = active
budget = 50000
goal = lead_generation
```

These are database values, not vectors.

### pgvector

Use pgvector inside the existing PostgreSQL environment wherever possible.

Store semantic information such as:

* brand knowledge
* brand voice information
* audience insights
* campaign learnings
* strategic insights
* content learnings
* useful historical knowledge
* semantic text that needs similarity retrieval

Do not create a separate vector database for this prototype.

Each vectorized record must retain enough metadata to identify:

* source record
* workspace/client/brand
* memory type
* embedding model/version

---

# 2. Redis

Do not introduce Redis in the prototype unless the existing codebase already depends on it for a necessary feature.

PostgreSQL is the default operational state store.

Do not add Redis simply for:

* caching without evidence
* workflow state
* locking
* "real-time" architecture
* architectural appearance

Only introduce it later when an actual measurable bottleneck justifies it.

---

# 3. Context Layer

Agents must not perform arbitrary database retrieval.

Build a small deterministic **Context Layer**.

It should map:

```text
task_type
    ↓
context recipe
    ↓
structured queries + semantic queries
    ↓
assembled context
```

A recipe should conceptually contain:

```text
task_type
sql_queries
vector_query
filters
top_k
section_limits
```

Recipes should be defined in code and versioned.

Do not allow an LLM to decide what database queries to run during normal execution.

The Context Layer is retrieval/assembly logic, not another reasoning agent.

Every assembled context must be traceable/loggable so a developer can determine what the agent actually saw during a run.

Handle empty retrieval safely.

Possible states include:

```text
context_available
insufficient_baseline
insufficient_relevance
```

Do not silently manufacture information when required context is missing.

---

# 4. Agents

Start with only three reasoning agents:

```text
Strategy Agent
Content Agent
Critic Agent
```

### Strategy Agent

Responsible for:

* ideation
* campaign direction
* hypotheses
* strategic recommendations

### Content Agent

Responsible for:

* content drafting
* channel-specific variations
* rewriting
* adapting approved strategy into content

### Critic Agent

Responsible for:

* independently challenging outputs
* detecting weak reasoning
* checking strategic/content quality
* identifying missing assumptions

The Critic should be an independent reasoning pass.

A separate model is preferred when practical, but do not block the prototype on requiring another provider/model.

---

# 5. Do NOT Create Unnecessary Agents

These should remain deterministic application logic:

```text
Brand voice
Scheduling
Analytics calculations
Basic validation
Database operations
Formatting
State transitions
```

Examples:

Brand voice → context constraint.

Scheduling → deterministic calendar logic.

Analytics → SQL/calculation.

Validation → code first; Critic handles interpretive review.

Do not create agents merely because a task is AI-related.

Use an agent only where reasoning under ambiguity is genuinely required.

---

# 6. Agent Contract

Every agent must:

```text
receive context
→ reason
→ return proposed output
```

Agents must:

* never directly write to PostgreSQL
* never directly update workflow state
* never call another agent
* never bypass the model router
* be testable using fixed context fixtures

Agents produce proposals.

The orchestrator decides whether those proposals are valid and applies them.

---

# 7. Orchestrator

Use this core workflow:

```text
Trigger
  ↓
Route
  ↓
Context Recipe
  ↓
Context Assembly
  ↓
Agent
  ↓
Deterministic Validation
  ↓
Critic when required
  ↓
Apply
  ↓
State Update
  ↓
Output
```

Routing should primarily be deterministic.

Do not add an LLM intent classifier unless the actual input requires genuinely ambiguous free-form routing.

The orchestrator is the sole authority for:

* database writes
* workflow transitions
* persistence
* agent sequencing
* tool execution
* approval transitions
* final application of proposed results

Agents propose.
Orchestrator applies.

---

# 8. Async Workflow Safety

For every asynchronous workflow that actually exists in the current prototype:

* use an idempotency key
* persist workflow state
* provide explicit terminal states
* handle failure branches
* make retries safe
* prevent duplicate writes/actions

Minimum states:

```text
pending
running
completed
failed
cancelled
```

Do not build a sophisticated job platform.

Use the simplest mechanism already compatible with the codebase.

---

# 9. Model Router

Every LLM call must pass through one shared model-router abstraction.

No feature-specific direct provider calls.

The router should initially support:

```text
task
model selection
token usage
latency
cost
failure information
```

Keep model selection simple initially:

```text
fast / standard / quality
```

Add provider fallback only where it is genuinely useful.

Do not create unnecessary model orchestration complexity.

---

# 10. Retrieval Implementation

Implement the minimum reliable retrieval system first.

Required now:

* pgvector
* metadata filtering
* embedding model/version tracking
* sensible top-k retrieval
* similarity threshold
* explicit empty/insufficient context handling

For structured knowledge, preserve record boundaries.

Do not blindly split structured records into arbitrary text chunks.

Example:

```text
campaign insight + outcome
```

should remain one semantic memory unit where possible.

### Later retrieval upgrades

Do NOT make these blockers for the first vertical workflow:

* hybrid lexical/BM25 search
* reciprocal-rank fusion
* reranking models
* automated retrieval evaluation pipelines

Design the retrieval interfaces so these can be added later without rewriting the agents.

---

# 11. Data Model Principle

Before creating tables, inspect the current use cases.

Create only the entities required by the product.

Use clear relationships such as:

```text
workspace
  ↓
client
  ↓
brand
  ↓
campaign
  ↓
content / strategy / metrics
```

Do not create speculative enterprise tables.

For semantic memories, maintain references back to their source records.

A semantic record should be traceable to:

```text
workspace/client
brand
memory type
source entity
content
embedding
embedding version
created/updated timestamps
```

---

# 12. Deferred Scope

Do not build the following as part of the core prototype:

```text
event sourcing
enterprise history architecture
advanced asset pipeline
complex realtime architecture
Kafka
ClickHouse
graph databases
distributed stream processing
microservice decomposition
complex memory infrastructure
Redis unless justified
```

Basic timestamps and ordinary PostgreSQL records are sufficient.

The architecture should remain extensible for these later.

---

# 13. Implementation Sequence

Do not build the architecture horizontally.

Build one complete vertical use case first.

Preferred sequence:

### Phase 0 — Repository audit

Inspect:

* existing backend
* database schema
* APIs
* current AI code
* current agents
* existing Supabase/Postgres usage
* current vector implementation
* workflows
* environment/configuration
* tests

Determine what can be reused.

Do not rewrite working code without reason.

### Phase 1 — Core data layer

Implement/refine:

```text
PostgreSQL schema
pgvector memory structure
relationships
workflow state
```

### Phase 2 — Context layer

Implement:

```text
task type
→ deterministic context recipe
→ SQL retrieval
→ vector retrieval
→ context assembly
```

### Phase 3 — Agent layer

Implement:

```text
Strategy
Content
Critic
```

using a shared agent interface.

### Phase 4 — Orchestrator

Implement:

```text
trigger
→ route
→ context
→ agent
→ validation
→ apply
→ state update
```

### Phase 5 — Model Router

Move all model calls behind the router.

### Phase 6 — First complete vertical workflow

Select the most important existing Platina AI OS use case.

Make the following work end to end:

```text
real input
→ real database state
→ real context retrieval
→ real agent
→ real reasoning
→ validation
→ real write-back
→ real output
```

Do not proceed to broad architecture expansion before this path works.

### Phase 7 — Expand horizontally

Only after the first workflow is stable:

```text
additional agents
additional context recipes
additional tools
additional workflows
additional memory types
```

---

# 14. Required Engineering Standards

While implementing:

* keep modules small
* use typed interfaces where the existing stack supports them
* keep business logic out of prompts
* keep prompts versionable
* validate model outputs structurally
* make database writes explicit
* avoid duplicated retrieval logic
* avoid duplicated model-client logic
* keep secrets in environment/configuration
* add useful errors instead of silent fallbacks
* preserve existing application behavior unless intentionally changing it

Do not optimize prematurely.

---

# 15. Testing

At minimum, test:

### Data

* schema relationships
* vector insertion/retrieval
* metadata filtering

### Context

* correct recipe selected
* correct SQL data returned
* semantic retrieval works
* empty retrieval handled correctly

### Agents

* fixed context → deterministic structure
* invalid output rejected
* Critic can challenge weak output

### Orchestrator

* correct routing
* successful state transition
* failed state transition
* retry safety
* idempotency

### End-to-end

At least one real Platina AI OS use case must pass completely through:

```text
Input
→ Context
→ Agent
→ Validation
→ Orchestrator
→ Database write
→ Output
```

---

# 16. Development Behaviour

Before changing code:

1. Inspect the existing implementation.
2. Identify where the current architecture violates the target ownership model.
3. Reuse working components.
4. Make the smallest change that moves the code toward the architecture.
5. Run tests/type checks/build after meaningful changes.
6. Fix regressions before continuing.
7. Keep the architecture documented as implementation evolves.

Do not generate a large theoretical architecture and then implement everything at once.

The codebase must remain runnable after each meaningful stage.

---

# Final Architectural Rule

Always preserve this mental model:

```text
POSTGRES
exact truth
    ↓
PGVECTOR
semantic meaning
    ↓
CONTEXT
select + assemble relevant information
    ↓
AGENTS
reason + propose
    ↓
ORCHESTRATOR
validate + execute + write
    ↓
APPLICATION STATE
```

Build for the current Platina AI OS use cases first.

Optimize for a **working prototype with clean boundaries**, not for theoretical enterprise scale.

When a future requirement needs more infrastructure, extend the architecture at that boundary instead of prematurely implementing it now.
