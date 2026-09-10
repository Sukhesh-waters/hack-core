import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { PlanEditableFields } from "@/lib/plan-cell";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
]);

export const clientStatus = pgEnum("client_status", [
  "active",
  "paused",
  "archived",
]);

export const clientGoalStatus = pgEnum("client_goal_status", [
  "active",
  "achieved",
  "abandoned",
]);

export const contentType = pgEnum("content_type", [
  "post",
  "reel",
  "story",
  "carousel",
  // S1: formats an agency plan actually tracks. talking_head and
  // motion_graphic are video (duration-bearing); static is not.
  "talking_head",
  "motion_graphic",
  "static",
]);

export type ContentTypeValue = (typeof contentType.enumValues)[number];

/**
 * Video formats — the only types allowed to carry a duration. Enforced in
 * validation (src/lib/validation.ts), not in the DB: a static row with a
 * duration is a caller error worth surfacing, not a column to silently drop.
 */
export const VIDEO_CONTENT_TYPES = [
  "reel",
  "talking_head",
  "motion_graphic",
] as const satisfies readonly ContentTypeValue[];

export function isVideoContentType(type: ContentTypeValue): boolean {
  return (VIDEO_CONTENT_TYPES as readonly string[]).includes(type);
}

export const contentStatus = pgEnum("content_status", [
  "draft",
  "review",
  "approved",
  "scheduled",
  "published",
]);

/**
 * Production kanban stage — internal work-tracking, independent of
 * contentStatus's approval pipeline. Happens BEFORE compliance/review even
 * starts; Studio/Approvals/Calendar never read this column, Production
 * never reads `status`.
 */
export const productionStage = pgEnum("production_stage", [
  "brief",
  "in_progress",
  "internal_review",
  "revision",
  "done",
]);

// Compliance agent output (W6). One violation per broken Brand DNA rule.
export type ComplianceViolation = {
  rule: string;
  excerpt: string;
  why: string;
};

export const complianceVerdict = pgEnum("compliance_verdict", [
  "pending",
  "passed",
  "flagged",
]);

// ---------------------------------------------------------------------------
// Identity (NextAuth adapter shape)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

// ---------------------------------------------------------------------------
// Tenancy: org → workspace → membership (constitution hierarchy)
// ---------------------------------------------------------------------------

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Shareable join code for the /join flow
    inviteCode: text("invite_code")
      .notNull()
      .unique()
      .$defaultFn(() => crypto.randomUUID().replace(/-/g, "").slice(0, 10)),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("workspaces_org_id_idx").on(table.orgId),
  }),
);

export const emailDigest = pgEnum("email_digest", [
  "immediate",
  "daily",
  "off",
]);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    /** S10 — per-member email preference. "off" silences email only; the
     *  in-app bell is never suppressed, because opting out of inbox noise
     *  is not the same as opting out of knowing your work exists. */
    emailDigest: emailDigest("email_digest").notNull().default("immediate"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("memberships_workspace_id_idx").on(table.workspaceId),
    userIdx: index("memberships_user_id_idx").on(table.userId),
    uniqueMember: uniqueIndex("memberships_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Workspace-scoped domain tables — workspace_id required + indexed, always
// ---------------------------------------------------------------------------

export const clients = pgTable(
  "clients",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    handle: text("handle"),
    // Nullable — the client's report recipient. Unset until someone fills it
    // in on the Reports page; "client" audience sends are blocked until set.
    contactEmail: text("contact_email"),
    status: clientStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("clients_workspace_id_idx").on(table.workspaceId),
  }),
);

/**
 * G1 — what a client is actually trying to achieve. The missing spine between
 * `clients` and `content`: ideation grounds in it, decisions (G2) attach to it.
 *
 * Deliberately NO targetValue numeric column. A numeric target invites the UI
 * to render "62% to goal" off a baseline that may be below MIN_BASELINE_N —
 * exactly the fabricated confidence the min-N gate exists to prevent. Goals are
 * qualitative direction-setters in v1; numeric targets arrive only alongside a
 * min-N-gated progress computation, as its own slice.
 */
export const clientGoals = pgTable(
  "client_goals",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    hypothesis: text("hypothesis"),
    metric: text("metric").notNull(),
    targetWindowStart: timestamp("target_window_start", {
      mode: "date",
    }).notNull(),
    targetWindowEnd: timestamp("target_window_end", { mode: "date" }).notNull(),
    status: clientGoalStatus("status").notNull().default("active"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("client_goals_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("client_goals_client_id_idx").on(table.clientId),
  }),
);

export const content = pgTable(
  "content",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: contentType("type").notNull().default("post"),
    title: text("title").notNull(),
    body: text("body"),
    status: contentStatus("status").notNull().default("draft"),
    // Drafts generated from an idea trace back to it (Phase 3 studio)
    ideaId: text("idea_id").references(() => ideas.id),
    // Compliance agent verdict (W6): pending until checked; flagged drafts
    // need a human — the agent gets exactly one retry, then stops.
    complianceStatus: complianceVerdict("compliance_status")
      .notNull()
      .default("pending"),
    complianceReport: jsonb("compliance_report").$type<ComplianceViolation[]>(),
    // Internal work-tracking stage (Production kanban). Null until Plan &
    // Validate's Accept seeds it at "brief" (src/lib/plan/accept-idea.ts).
    productionStage: productionStage("production_stage"),
    // Bumped only when a card is sent back internal_review → revision
    // (src/lib/production.ts). Surfaced as a "revised ×N" flag on the card.
    revisionCount: integer("revision_count").notNull().default(0),
    // S1 — plan-grid fields. All nullable: existing rows predate them and
    // no backfill is meaningful (there is no honest default for "who owns
    // this" or "why this post").
    // Null for non-video formats; see VIDEO_CONTENT_TYPES.
    durationSec: integer("duration_sec"),
    // Content pillar / core theme this post serves.
    pillar: text("pillar"),
    // Free text: the "why this post" a planner would say out loud.
    strategyNote: text("strategy_note"),
    assigneeId: text("assignee_id").references(() => users.id),
    dueAt: timestamp("due_at", { mode: "date" }),
    /**
     * F2 — user-defined field values, keyed by custom_field_definitions.id.
     *
     * Stored here rather than in an EAV table so reading a row costs no
     * join. Keys are definition ids, not names, so renaming a field doesn't
     * orphan every value already stored under the old name.
     */
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
    /**
     * W1 — the engine's authoritative state. Lives ALONGSIDE
     * production_stage, which 22 files still read; transitions dual-write
     * both so nothing breaks while surfaces migrate one diff at a time.
     * Nullable only until the backfill runs — after that every row has one.
     */
    workflowStateId: text("workflow_state_id").references(
      (): AnyPgColumn => workflowStates.id,
    ),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("content_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("content_client_id_idx").on(table.clientId),
    productionStageIdx: index("content_production_stage_idx").on(
      table.productionStage,
    ),
    // S1 — both are the driving predicates of S7's "My work" queries.
    assigneeIdx: index("content_assignee_id_idx").on(table.assigneeId),
    dueAtIdx: index("content_due_at_idx").on(table.dueAt),
    // Invariant: at most one content row may claim an idea — DB-level
    // backstop for the claim-first race guard in claimIdeaForDraftingQuery.
    ideaUnique: uniqueIndex("content_idea_id_unique")
      .on(table.ideaId)
      .where(sql`${table.ideaId} is not null`),
  }),
);

/**
 * U7 — one saved plan-grid view per person per workspace.
 *
 * Deliberately NOT named/shareable filters. The URL already carries the
 * whole view, so sharing works today by pasting a link; what the URL cannot
 * do is remember what you had open last time. This table does only that.
 *
 * Per user AND per workspace: an operator running three clients wants a
 * different default in each, and a single per-user row would make the last
 * workspace they touched overwrite the others.
 */
export const planViewPreferences = pgTable(
  "plan_view_preferences",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Matches PLAN_SCOPES in src/lib/plan-view.ts — stored as text rather
     *  than an enum so adding a scope is a code change, not a migration. */
    scope: text("scope").notNull().default("all"),
    /** The target a scope needs, when it needs one. */
    scopeClientId: text("scope_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    scopeUserId: text("scope_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    grouping: text("grouping").notNull().default("none"),
    /** Column keys the user hid. Storing HIDDEN rather than VISIBLE means a
     *  newly added column shows up by default instead of being invisible to
     *  everyone who saved a view before it existed. */
    hiddenColumns: jsonb("hidden_columns").$type<string[]>(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    // One row per person per workspace — upsert target.
    userWorkspaceUnique: uniqueIndex(
      "plan_view_preferences_user_workspace_unique",
    ).on(table.workspaceId, table.userId),
  }),
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// W1 — the workflow engine.
//
// Before this, every workflow in the product was a hardcoded TypeScript map
// (lib/production.ts, lib/idea-workflow.ts, the ticketStatus enum), which
// meant the software could express exactly one agency's process — ours.
// These tables move that decision from compile time to runtime, per
// workspace, which is the difference between an app and a platform.
//
// Migration is strangler-fig, never a big bang: production_stage is read by
// 22 files, so it survives. Every workspace is seeded a default workflow
// whose states mirror that enum exactly, content rows are backfilled, and
// transitions dual-write both columns. A workspace that never customises
// sees a pixel-identical product — that is the acceptance test.
// ---------------------------------------------------------------------------

/** What a state *means*, independent of what it's called. Cycle-time and
 *  WIP metrics key off this, so "Shoot" and "Editing" can both be `doing`
 *  without the dashboard needing to know either name. */
export const workflowStateCategory = pgEnum("workflow_state_category", [
  "todo",
  "doing",
  "done",
]);

/** The kind of thing a workflow governs. Seeded with "content"; a workspace
 *  can add its own (e.g. "Shoot day", "Client request"). */
export const workTypes = pgTable(
  "work_types",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Stable machine key — seeded types use "content"/"ticket" so code can
     *  find them without depending on a user-editable display name. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("work_types_workspace_id_idx").on(table.workspaceId),
    keyUnique: uniqueIndex("work_types_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
  }),
);

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workTypeId: text("work_type_id")
      .notNull()
      .references(() => workTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Exactly one default per work type — the workflow new rows adopt. */
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("workflows_workspace_id_idx").on(table.workspaceId),
    workTypeIdx: index("workflows_work_type_id_idx").on(table.workTypeId),
  }),
);

export const workflowStates = pgTable(
  "workflow_states",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    category: workflowStateCategory("category").notNull(),
    /** Static, fully-written Tailwind chip class — the JIT scans source
     *  text, so this is picked from a fixed palette in lib/workflow, never
     *  template-built from a stored hex. */
    colorKey: text("color_key").notNull().default("slate"),
    position: integer("position").notNull().default(0),
    /** Null = no limit. A board column warns past this. */
    wipLimit: integer("wip_limit"),
    /**
     * The production_stage enum value this state mirrors, for seeded
     * states only. Custom states have null and simply don't dual-write —
     * which is why the legacy column can never be corrupted by a state the
     * enum has no word for.
     */
    legacyStage: productionStage("legacy_stage"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("workflow_states_workspace_id_idx").on(
      table.workspaceId,
    ),
    workflowIdx: index("workflow_states_workflow_id_idx").on(table.workflowId),
    keyUnique: uniqueIndex("workflow_states_workflow_key_unique").on(
      table.workflowId,
      table.key,
    ),
  }),
);

export const workflowTransitions = pgTable(
  "workflow_transitions",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    /** Null = the initial transition (what a brand-new row adopts). */
    fromStateId: text("from_state_id").references(() => workflowStates.id, {
      onDelete: "cascade",
    }),
    toStateId: text("to_state_id")
      .notNull()
      .references(() => workflowStates.id, { onDelete: "cascade" }),
    /** The verb shown in the menu — "Start", "Send back", "Resubmit".
     *  A transition menu that reads "Revision" teaches nothing; one that
     *  reads "Send back" teaches the process. */
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    /** W5. Typed jsonb arrays validated through one registry, matching the
     *  automationRules trigger/action pattern rather than inventing three
     *  more tables. Empty array = unconditional. */
    conditions: jsonb("conditions")
      .$type<WorkflowRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    validators: jsonb("validators")
      .$type<WorkflowRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    postActions: jsonb("post_actions")
      .$type<WorkflowRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("workflow_transitions_workspace_id_idx").on(
      table.workspaceId,
    ),
    workflowIdx: index("workflow_transitions_workflow_id_idx").on(
      table.workflowId,
    ),
    fromIdx: index("workflow_transitions_from_state_idx").on(table.fromStateId),
  }),
);

/** One transition rule. `kind` selects the handler from the registry in
 *  lib/workflow/rules; `config` is that handler's own validated shape. */
export type WorkflowRule = {
  kind: string;
  config: Record<string, unknown>;
};

// F1/F2 — user-defined fields.
//
// Two tables, not one: a definition is owned by the workspace, and its
// attachment to a subject type is a separate fact. That split is what makes
// "reuse this field on another type" a row insert instead of a duplicate
// definition — the same reason the reference product offers a field library
// rather than re-declaring a field per type.
//
// Values do NOT live here. They live in a jsonb column on the subject row
// (see content.customFields), which avoids a join on every read. EAV would
// buy cross-row queryability nobody needs at small-agency scale.
// ---------------------------------------------------------------------------

export const customFieldType = pgEnum("custom_field_type", [
  "short_text",
  "paragraph",
  "date",
  "number",
  "timestamp",
  "labels",
  "dropdown",
  "checkbox",
  "people",
  "url",
]);

export const customFieldSubject = pgEnum("custom_field_subject", [
  "content",
  "idea",
  "ticket",
  "campaign",
  "client",
]);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: customFieldType("type").notNull(),
    /** Only meaningful for types whose meaning is their option list
     *  (dropdown). Validated against the registry, not just "is an array". */
    options: jsonb("options").$type<string[]>(),
    required: boolean("required").notNull().default(false),
    /** Soft-retire rather than delete: values already stored on subject rows
     *  reference this id, and a hard delete would strand them as unreadable
     *  jsonb keys. Archived fields stop being offered but stay resolvable. */
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("custom_field_definitions_workspace_id_idx").on(
      table.workspaceId,
    ),
    // Two fields with the same name in one workspace is a support ticket
    // waiting to happen — you cannot tell them apart in a picker.
    nameUnique: uniqueIndex("custom_field_definitions_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
  }),
);

export const customFieldAssignments = pgTable(
  "custom_field_assignments",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fieldId: text("field_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    subjectType: customFieldSubject("subject_type").notNull(),
    /** Display order within that subject type — the drag-to-reorder list. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("custom_field_assignments_workspace_id_idx").on(
      table.workspaceId,
    ),
    subjectIdx: index("custom_field_assignments_subject_idx").on(
      table.workspaceId,
      table.subjectType,
    ),
    // A field attached twice to the same type would render twice.
    onceePerSubject: uniqueIndex(
      "custom_field_assignments_field_subject_unique",
    ).on(table.fieldId, table.subjectType),
  }),
);

// ---------------------------------------------------------------------------
// S6 — one table answering "what happened to this thing, and who did it"
// for every object type.
//
// This does not add a fourth task system. There are already three mutually
// blind ones (content.productionStage, hubTasks, tickets); this makes them
// observable from one place rather than unifying them.
//
// subjectId carries no FK on purpose — it is polymorphic across six subject
// types, matching the existing linkedType/linkedId idiom on tickets. The
// cost is no referential integrity on the subject; the alternative is six
// nullable FK columns, which is worse.
// ---------------------------------------------------------------------------

export const activitySubject = pgEnum("activity_subject", [
  "content",
  "idea",
  "ticket",
  "campaign",
  "doc",
  "client",
  "sop_run_step",
  "hub_task",
  "hub_message",
  "hub_approval",
  "hub_reminder",
]);

export const activity = pgTable(
  "activity",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subjectType: activitySubject("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Null means the system did it — an automation or a scheduled sweep,
     *  not a person. Rendering that as a user would be a lie. */
    actorId: text("actor_id").references(() => users.id),
    verb: text("verb").notNull(),
    /** { from, to } and similar. Never PII. */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("activity_workspace_id_idx").on(table.workspaceId),
    subjectIdx: index("activity_subject_idx").on(
      table.subjectType,
      table.subjectId,
    ),
    createdIdx: index("activity_created_at_idx").on(table.createdAt),
  }),
);

/**
 * S9 — "this specific person needs to do something."
 *
 * The split from `activity` is the whole design: activity records that a
 * thing happened, notifications record that a named person is on the hook.
 * A workspace-wide event writes activity and no notification, because a
 * bell that lights up for everyone teaches people to ignore the bell.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "assigned" | "due_soon" | "mentioned" | "approval_needed" */
    kind: text("kind").notNull(),
    subjectType: activitySubject("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    userUnreadIdx: index("notifications_user_unread_idx").on(
      table.userId,
      table.readAt,
    ),
    workspaceIdx: index("notifications_workspace_id_idx").on(table.workspaceId),
  }),
);

// ---------------------------------------------------------------------------
// S4 — proposed changes to a plan row, by a human or the AI.
//
// This is deliberately NOT version control. No branches, no merge, no
// three-way diff, no commit graph — those were ruled out up front. It exists
// for one reason: S3 lets the AI propose plan-row changes, and a proposal
// needs somewhere to live that is not the row itself, so nothing the model
// suggests can silently become the plan.
//
// Append-only. Nothing may UPDATE a revision except to stamp appliedAt /
// appliedById, and there is no DELETE path.
// ---------------------------------------------------------------------------

export const revisionAuthorKind = pgEnum("revision_author_kind", [
  "human",
  "ai",
]);

export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contentId: text("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    authorKind: revisionAuthorKind("author_kind").notNull(),
    /** Null when authorKind is "ai" — there is no user behind the change. */
    authorId: text("author_id").references(() => users.id),
    /** Only the changed subset, never a full row snapshot. */
    fields: jsonb("fields").$type<Partial<PlanEditableFields>>().notNull(),
    /** What those same fields held when the change was proposed, so the
     *  compare view can show current-vs-proposed without guessing. */
    priorFields: jsonb("prior_fields")
      .$type<Partial<PlanEditableFields>>()
      .notNull(),
    note: text("note"),
    appliedAt: timestamp("applied_at", { mode: "date" }),
    appliedById: text("applied_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("content_revisions_workspace_id_idx").on(
      table.workspaceId,
    ),
    contentIdx: index("content_revisions_content_id_idx").on(table.contentId),
  }),
);

// ---------------------------------------------------------------------------
// Ads Management (Slice 4). Campaign brief tracker + approval gate only —
// no live ad-platform connector exists. spend/impressions/clicks/conversions
// stay at zero forever under the current UI and are intentionally NOT
// rendered anywhere (see ads/page.tsx, ads/campaign-row.tsx) — showing them
// would misrepresent planning data as live performance. Columns are kept
// for a future ad-platform connector to write into; do not surface them in
// the UI until that connector exists.
// ---------------------------------------------------------------------------

export const campaignObjective = pgEnum("campaign_objective", [
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "conversions",
]);

export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "pending_approval",
  "active",
  "paused",
  "rejected",
]);

export type CampaignAudience = {
  demographics?: string;
  interests?: string[];
  locations?: string[];
};

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    objective: campaignObjective("objective").notNull(),
    audience: jsonb("audience").$type<CampaignAudience>().notNull().default({}),
    budget: real("budget").notNull(),
    startDate: timestamp("start_date", { mode: "date" }).notNull(),
    endDate: timestamp("end_date", { mode: "date" }),
    // No image/video generation exists in this codebase — creative is
    // either a link to an existing Studio draft or a free-text note.
    creativeContentId: text("creative_content_id").references(() => content.id),
    creativeNote: text("creative_note"),
    status: campaignStatus("status").notNull().default("draft"),
    spend: real("spend").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("campaigns_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("campaigns_client_id_idx").on(table.clientId),
  }),
);

// ---------------------------------------------------------------------------
// Ingestion layer (W2). Two-layer rule: source separates first-party truth
// from public pattern rows; the baseline engine filters on it (see
// src/db/queries/posts.ts). weight stays neutral (1) for public rows.
// ---------------------------------------------------------------------------

export const ingestSource = pgEnum("ingest_source", ["first_party", "public"]);
export const scoreStatus = pgEnum("score_status", [
  "scored",
  "insufficient_baseline",
  "unscored",
]);
export const scoreDirection = pgEnum("score_direction", ["up", "down", "flat"]);
export const importJobStatus = pgEnum("import_job_status", [
  "processing",
  "complete",
  "failed",
]);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    status: importJobStatus("status").notNull().default("processing"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("import_jobs_workspace_id_idx").on(table.workspaceId),
  }),
);

export const posts = pgTable(
  "posts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    importJobId: text("import_job_id").references(() => importJobs.id),
    source: ingestSource("source").notNull().default("first_party"),
    weight: real("weight").notNull().default(1),
    externalId: text("external_id"),
    caption: text("caption"),
    format: text("format"),
    topics: jsonb("topics").$type<string[]>(),
    postedAt: timestamp("posted_at", { mode: "date" }).notNull(),
    reach: integer("reach"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    engagementRate: real("engagement_rate"),
    zScore: real("z_score"),
    magnitude: real("magnitude"),
    direction: scoreDirection("direction"),
    scoreStatus: scoreStatus("score_status").notNull().default("unscored"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("posts_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("posts_client_id_idx").on(table.clientId),
    sourceIdx: index("posts_source_idx").on(table.source),
    workspaceSourcePostedIdx: index("posts_workspace_source_posted_idx").on(
      table.workspaceId,
      table.source,
      table.postedAt,
    ),
  }),
);

export const postEmbeddings = pgTable(
  "post_embeddings",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .unique()
      .references(() => posts.id, { onDelete: "cascade" }),
    source: ingestSource("source").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("post_embeddings_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Connectors (Phase 2). connected_accounts drives first-party pulls (Meta,
// feature-flagged). pattern_posts is the public pattern layer's OWN
// namespace: source=public, weight neutral, and structurally score-free —
// a pattern row cannot carry performance truth (two-layer rule).
// ---------------------------------------------------------------------------

export const connectorProvider = pgEnum("connector_provider", ["meta"]);
export const connectionStatus = pgEnum("connection_status", [
  "connected",
  "error",
  "disconnected",
]);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    provider: connectorProvider("provider").notNull().default("meta"),
    igUserId: text("ig_user_id").notNull(),
    // AES-256-GCM via src/lib/crypto.ts — never store the raw token.
    accessTokenEnc: text("access_token_enc").notNull(),
    status: connectionStatus("status").notNull().default("connected"),
    lastPullAt: timestamp("last_pull_at", { mode: "date" }),
    tokenExpiresAt: timestamp("token_expires_at", { mode: "date" }),
    backfillCursor: text("backfill_cursor"),
    backfillCompletedAt: timestamp("backfill_completed_at", { mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("connected_accounts_workspace_id_idx").on(
      table.workspaceId,
    ),
    uniquePerClient: uniqueIndex(
      "connected_accounts_client_provider_unique",
    ).on(table.workspaceId, table.clientId, table.provider),
  }),
);

export const patternPosts = pgTable(
  "pattern_posts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageHandle: text("page_handle").notNull(),
    source: ingestSource("source").notNull().default("public"),
    weight: real("weight").notNull().default(1),
    externalId: text("external_id"),
    caption: text("caption"),
    format: text("format"),
    postedAt: timestamp("posted_at", { mode: "date" }).notNull(),
    likes: integer("likes"),
    comments: integer("comments"),
    raw: jsonb("raw"),
    // Harness provenance (Slice E): which scheduled run + segment produced
    // this row. Null for rows ingested via the one-shot public-page action.
    runId: text("run_id"),
    segment: text("segment"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("pattern_posts_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

export const patternAds = pgTable(
  "pattern_ads",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageHandle: text("page_handle").notNull(),
    source: ingestSource("source").notNull().default("public"),
    weight: real("weight").notNull().default(1),
    externalId: text("external_id"),
    adBody: text("ad_body"),
    adFormat: text("ad_format"),
    targetAudience: text("target_audience"),
    postedAt: timestamp("posted_at", { mode: "date" }).notNull(),
    raw: jsonb("raw"),
    runId: text("run_id"),
    segment: text("segment"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("pattern_ads_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);
// Apify harness layer (Slice E). harness_rules says WHAT to scrape (segments),
// HOW MUCH (cap ≤ 100) and WHEN (cadence); pattern_runs is the audit trail.
// Results land in pattern_posts / pattern_profiles / pattern_comments —
// two-layer rule holds (source=public, weight neutral).
// ---------------------------------------------------------------------------

export type HarnessSegment = {
  kind: "competitor_handle" | "hashtag" | "niche_query" | "tiktok_handle" | "ad_library_page" | "website_url";
  value: string;
  note?: string;
  /** A2: route to reels actor when "reels"; default "posts" (backward compat). */
  target?: "posts" | "reels";
  /** A4: opt-in comment mining for top posts in this segment. */
  mineComments?: boolean;
};

export const harnessCadence = pgEnum("harness_cadence", [
  "manual",
  "daily",
  "weekly",
]);
export const patternRunStatus = pgEnum("pattern_run_status", [
  "queued",
  "running",
  "done",
  "failed",
]);

export const harnessRules = pgTable(
  "harness_rules",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    segments: jsonb("segments").$type<HarnessSegment[]>().notNull(),
    maxPostsPerRun: integer("max_posts_per_run").notNull().default(30),
    cadence: harnessCadence("cadence").notNull().default("manual"),
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("harness_rules_workspace_id_idx").on(
      table.workspaceId,
    ),
    // One harness config per workspace
    uniquePerWorkspace: uniqueIndex("harness_rules_workspace_unique").on(
      table.workspaceId,
    ),
  }),
).enableRLS();

export const patternRuns = pgTable(
  "pattern_runs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    harnessRuleId: text("harness_rule_id")
      .notNull()
      .references(() => harnessRules.id, { onDelete: "cascade" }),
    // Snapshot of the segment at run time — rules are editable
    segment: jsonb("segment").$type<HarnessSegment>().notNull(),
    /** A5: which Apify actor ran (e.g. "instagram-scraper", "instagram-reel-scraper"). */
    actor: text("actor"),
    status: patternRunStatus("status").notNull().default("queued"),
    postsFetched: integer("posts_fetched").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("pattern_runs_workspace_id_idx").on(table.workspaceId),
    ruleIdx: index("pattern_runs_rule_id_idx").on(table.harnessRuleId),
  }),
).enableRLS();

/**
 * G3 — a persisted pattern observation. PATTERN-LAYER EVIDENCE ONLY.
 *
 * The column is named `evidence_pattern_ids`, not `evidence_ids`, so the
 * two-layer distinction (I2) is visible at the schema level — the same
 * discipline that keeps `pattern_posts` free of score columns. This must never
 * be unioned with `decisions.evidence_post_ids`, which holds first-party ids.
 * Those are different columns on different tables on purpose.
 */
export const insights = pgTable(
  "insights",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    suggestion: text("suggestion").notNull(),
    evidencePatternIds: jsonb("evidence_pattern_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    patternRunId: text("pattern_run_id").references(() => patternRuns.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("insights_workspace_id_idx").on(table.workspaceId),
  }),
);

export const decisionOutcome = pgEnum("decision_outcome", [
  "pending",
  "worked",
  "did_not_work",
  "inconclusive",
]);

/**
 * G2 — a decision receipt: what we chose, why, on what evidence, what we
 * expected, and (after review) whether it worked. The causal counterpart to the
 * statistical loop in rescore.ts.
 *
 * evidencePostIds is FIRST-PARTY ONLY, enforced by validateDecisionEvidence.
 * insightId is a SEPARATE column on purpose — a pattern-layer insight can be
 * what prompted a decision, but it is never merged into the first-party
 * evidence array. Two layers, two columns, never unioned (I2).
 */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Nullable — workspace-level decisions exist, not everything is per-client. */
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    goalId: text("goal_id").references(() => clientGoals.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    evidencePostIds: jsonb("evidence_post_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    insightId: text("insight_id").references(() => insights.id, {
      onDelete: "set null",
    }),
    expectedOutcome: text("expected_outcome").notNull(),
    reviewAt: timestamp("review_at", { mode: "date" }).notNull(),
    outcome: decisionOutcome("outcome").notNull().default("pending"),
    outcomeNote: text("outcome_note"),
    // Stamped by the daily review cron the first time it surfaces this
    // decision to Team Hub — a separate column from updatedAt on purpose,
    // since updatedAt could be touched by unrelated future edits and would
    // make "did we already remind them today" ambiguous.
    reviewSurfacedAt: timestamp("review_surfaced_at", { mode: "date" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("decisions_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("decisions_client_id_idx").on(table.clientId),
    reviewIdx: index("decisions_review_at_idx").on(table.reviewAt),
  }),
);

// ---------------------------------------------------------------------------
// A3: Competitor profile snapshots (pattern layer — source=public).
// One row per handle per snapshot; enables follower-growth deltas over time.
// ---------------------------------------------------------------------------

export const patternProfiles = pgTable(
  "pattern_profiles",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    followers: integer("followers").notNull().default(0),
    following: integer("following").notNull().default(0),
    postsCount: integer("posts_count").notNull().default(0),
    bio: text("bio"),
    isVerified: boolean("is_verified").notNull().default(false),
    businessCategory: text("business_category"),
    profilePicUrl: text("profile_pic_url"),
    externalUrl: text("external_url"),
    takenAt: timestamp("taken_at", { mode: "date" }).notNull().defaultNow(),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("pattern_profiles_workspace_id_idx").on(
      table.workspaceId,
    ),
    handleIdx: index("pattern_profiles_handle_idx").on(table.handle),
  }),
);

// ---------------------------------------------------------------------------
// A4: Comment mining (opt-in per harness rule segment).
// Top ≤5 posts by likes → comment scraper, ≤20 comments each.
// ---------------------------------------------------------------------------

export const patternComments = pgTable(
  "pattern_comments",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    patternPostId: text("pattern_post_id")
      .notNull()
      .references(() => patternPosts.id, { onDelete: "cascade" }),
    authorHandle: text("author_handle"),
    text: text("text").notNull(),
    likes: integer("likes").notNull().default(0),
    takenAt: timestamp("taken_at", { mode: "date" }).notNull(),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("pattern_comments_workspace_id_idx").on(
      table.workspaceId,
    ),
    postIdx: index("pattern_comments_post_id_idx").on(table.patternPostId),
  }),
);

// ---------------------------------------------------------------------------
// Intelligence layer (Phase 3). brand_profiles caches the one-time Brand DNA
// research per client; ideas carry the "why this idea" citations, which may
// reference first-party baseline posts ONLY (guardrail:
// src/lib/ai/ideation-agent.ts validateCitations).
// ---------------------------------------------------------------------------

export type BrandIdentity = {
  voice: string;
  tone: string;
  audience: string;
  pillars: string[];
  doNots: string[];
  formats: string[];
};

/**
 * Human-declared brand context, captured at intake and editable forever.
 * Lives beside the AI-derived `identity` — never overwritten by research;
 * mergeBrandDna (src/lib/ai/brand-merge.ts) resolves conflicts, declared wins.
 */
export type BrandContext = {
  brandType:
    | "personal_brand"
    | "product_promotion"
    | "aesthetic_lifestyle"
    | "minimalistic"
    | "educational_authority"
    | "community_ugc";
  mission: string;
  showcaseTheme: string;
  tones: string[];
  pillars: string[];
  bannedWords: string[];
  avoidTopics: string[];
  colors: string[];
  typography: string | null;
  logoUrl: string | null;
  links: {
    website?: string;
    instagram?: string;
    facebook?: string;
    other?: string[];
  };
};

// Lifecycle: declared → researching → ready | failed. "declared" = human
// context captured at intake, AI enrichment not yet run — generation may
// already work off merged DNA. ("declared" appended last: PG enums only
// accept ADD VALUE without a rewrite.)
export const brandStatus = pgEnum("brand_status", [
  "researching",
  "ready",
  "failed",
  "declared",
]);
export const ideaStatus = pgEnum("idea_status", ["new", "drafted", "archived"]);

export const brandProfiles = pgTable(
  "brand_profiles",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    identity: jsonb("identity").$type<BrandIdentity>(),
    declared: jsonb("declared").$type<BrandContext>(),
    // Vault edits stamp this WITHOUT bumping updated_at; research bumps
    // updated_at — declared_updated_at > updated_at ⇒ enrichment is stale.
    declaredUpdatedAt: timestamp("declared_updated_at", { mode: "date" }),
    status: brandStatus("status").notNull().default("researching"),
    error: text("error"),
    model: text("model"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("brand_profiles_workspace_id_idx").on(
      table.workspaceId,
    ),
    // Cached, runs once: exactly one profile per client per workspace
    uniquePerClient: uniqueIndex("brand_profiles_client_unique").on(
      table.workspaceId,
      table.clientId,
    ),
  }),
);

export const knowledgeSourceStatus = pgEnum("knowledge_source_status", [
  "pending",
  "ready",
  "failed",
]);

/**
 * Brand Gene → Knowledge tab: URLs the client pastes in to seed reference
 * material. First-party/declared-adjacent by construction (the client chose
 * to paste it) — NEVER routed through source="public"/pattern-layer tables.
 * Mirrors importJobs → posts: one status-tracked parent row per ingest.
 */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    url: text("url"),
    title: text("title"),
    sourceKind: text("source_kind").notNull().default("url"),
    docId: text("doc_id").references(() => workspaceDocs.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    status: knowledgeSourceStatus("status").notNull().default("pending"),
    chunkCount: integer("chunk_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("knowledge_sources_workspace_id_idx").on(
      table.workspaceId,
    ),
    clientIdx: index("knowledge_sources_client_id_idx").on(table.clientId),
    assetIdx: index("knowledge_sources_asset_id_idx").on(table.assetId),
  }),
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // Nullable: embedding is an enhancement, same degradation-ladder stance
    // as postEmbeddings — a chunk can exist with content but no vector if
    // the embed call fails; it just won't surface in similarity search.
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("knowledge_chunks_workspace_id_idx").on(
      table.workspaceId,
    ),
    sourceIdx: index("knowledge_chunks_source_id_idx").on(table.sourceId),
  }),
);

export const ideas = pgTable(
  "ideas",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    hook: text("hook").notNull(),
    angle: text("angle"),
    format: text("format"),
    whyReason: text("why_reason"),
    // posts.id values from the first-party baseline — never pattern rows
    citations: jsonb("citations").$type<string[]>(),
    status: ideaStatus("status").notNull().default("new"),
    // Populated only by Plan & Validate's Reject-with-reason form; null for
    // accepted/still-new ideas. Team Hub's quick reject leaves this null.
    rejectionReason: text("rejection_reason"),
    // If this idea was created by combining multiple ideas, stores the source idea ids
    combinedFrom: jsonb("combined_from").$type<string[]>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("ideas_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("ideas_client_id_idx").on(table.clientId),
  }),
);

// ---------------------------------------------------------------------------
// Scheduling (W6). One slot per approved content; the Inngest reminder cron
// sweeps rows due within 24h whose reminder_sent_at is still null.
// ---------------------------------------------------------------------------

export const schedule = pgTable(
  "schedule",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contentId: text("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", { mode: "date" }).notNull(),
    reminderSentAt: timestamp("reminder_sent_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("schedule_workspace_id_idx").on(table.workspaceId),
    scheduledForIdx: index("schedule_scheduled_for_idx").on(table.scheduledFor),
    // One slot per content item
    contentUnique: uniqueIndex("schedule_content_unique").on(table.contentId),
  }),
);

// ---------------------------------------------------------------------------
// Collaboration (Phase 5). Flat comment thread per content item. Realtime is
// deferred — the UI polls (W7-sanctioned fallback).
// ---------------------------------------------------------------------------

export const comments = pgTable(
  "comments",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contentId: text("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("comments_workspace_id_idx").on(table.workspaceId),
    contentIdx: index("comments_content_id_idx").on(table.contentId),
  }),
);

// ---------------------------------------------------------------------------
// Team Hub (Phase B). Workspace channel: chat, ad-hoc sign-offs, shared
// tasks and reminders. Realtime is signal-only broadcast; these rows are
// the source of truth. hub_approvals.content_id stays null until the
// Plan/Production slices link sign-offs to content items.
// ---------------------------------------------------------------------------

export const hubMessageKind = pgEnum("hub_message_kind", [
  "system",
  "text",
  "approval",
]);
export const hubApprovalStatus = pgEnum("hub_approval_status", [
  "pending",
  "approved",
  "rejected",
]);
export const hubPriority = pgEnum("hub_priority", ["high", "medium", "low"]);

export const hubApprovals = pgTable(
  "hub_approvals",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: hubApprovalStatus("status").notNull().default("pending"),
    decidedById: text("decided_by_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    contentId: text("content_id").references(() => content.id),
    // Ads Management: campaign-launch approvals link back here so a
    // decision cascades to campaigns.status (see decideHubApproval).
    campaignId: text("campaign_id").references(() => campaigns.id),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_approvals_workspace_id_idx").on(table.workspaceId),
  }),
);

export const hubMessages = pgTable(
  "hub_messages",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: hubMessageKind("kind").notNull().default("text"),
    // null for system lines
    authorId: text("author_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    // text/system messages
    body: text("body"),
    // approval cards
    approvalId: text("approval_id").references(() => hubApprovals.id, {
      onDelete: "cascade",
    }),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_messages_workspace_id_idx").on(table.workspaceId),
    createdIdx: index("hub_messages_created_at_idx").on(table.createdAt),
  }),
);

export const hubTasks = pgTable(
  "hub_tasks",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    priority: hubPriority("priority").notNull().default("medium"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { mode: "date" }),
    completedAt: timestamp("completed_at", { mode: "date" }),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    originRunStepId: text("origin_run_step_id").references(
      () => sopRunSteps.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_tasks_workspace_id_idx").on(table.workspaceId),
    originRunStepIdx: index("hub_tasks_origin_run_step_id_idx").on(
      table.originRunStepId,
    ),
  }),
);

export const hubReminders = pgTable(
  "hub_reminders",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { mode: "date" }).notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notifiedAt: timestamp("notified_at", { mode: "date" }),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("hub_reminders_workspace_id_idx").on(table.workspaceId),
    dueIdx: index("hub_reminders_due_at_idx").on(table.dueAt),
  }),
);

// ---------------------------------------------------------------------------
// Report send-log (F1). Audit trail for outbound report emails — records
// every send attempt (success and failure) so "did the June report go out"
// has a real answer instead of relying on fire-and-forget delivery.
// ---------------------------------------------------------------------------

export const reportSendStatus = pgEnum("report_send_status", [
  "sent",
  "failed",
]);

export const reportSends = pgTable(
  "report_sends",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    sentByUserId: text("sent_by_user_id")
      .notNull()
      .references(() => users.id),
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    audience: text("audience").notNull(), // "team" | "client" — plain text,
    // validated in zod, to avoid a second enum migration for two values.
    subject: text("subject").notNull(),
    body: text("body").notNull(), // exact text that left the app
    status: reportSendStatus("status").notNull(),
    error: text("error"), // provider error when status = "failed"
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("report_sends_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("report_sends_client_id_idx").on(table.clientId),
  }),
);

// ---------------------------------------------------------------------------
// Tickets core (T1). General-purpose internal ticket/task system — separate
// from hub_tasks (left as-is, simple checklist already wired into Hub's
// realtime feed). linked_type/linked_id are informational deep-links only
// (no FK, no cascade) — a linked idea/content/campaign/client being deleted
// must not delete the ticket. priority reuses hub_priority (no duplicate
// enum) per the plan's design decision.
// ---------------------------------------------------------------------------

export const ticketStatus = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "blocked",
  "done",
]);

export const ticketLinkType = pgEnum("ticket_link_type", [
  "content",
  "idea",
  "campaign",
  "client",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: ticketStatus("status").notNull().default("open"),
    workflowStateId: text("workflow_state_id").references(
      () => workflowStates.id,
      { onDelete: "set null" },
    ),
    // Reuses hub_priority (high/medium/low) — do not duplicate the enum.
    priority: hubPriority("priority").notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => users.id),
    dueAt: timestamp("due_at", { mode: "date" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    // Both-or-neither with linkedId — no FK, informational deep-link only.
    linkedType: ticketLinkType("linked_type"),
    linkedId: text("linked_id"),
    // F9.5: a real, queryable FK for "tickets belonging to this client" —
    // deliberately separate from the informational linkedType/linkedId pair
    // above (that field was never meant to be a primary query key). Nullable
    // — a ticket with no client is still valid.
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    // T3: freeform labels, filterable via ticketsQuery's opts.label. Additive
    // column, no new table — see jira-confluence-plan.md T3 design decision.
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // T5: sub-tasks. Self-referencing FK — unlike linkedType/linkedId (an
    // informational deep-link, no FK), a sub-task genuinely belongs to its
    // parent, so cascade-on-delete IS correct here: deleting the parent
    // deletes its sub-tasks too. Nullable — most tickets have no parent.
    parentTicketId: text("parent_ticket_id").references(
      (): AnyPgColumn => tickets.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("tickets_workspace_id_idx").on(table.workspaceId),
    assigneeIdx: index("tickets_assignee_id_idx").on(table.assigneeId),
    statusIdx: index("tickets_status_idx").on(table.status),
    parentIdx: index("tickets_parent_ticket_id_idx").on(table.parentTicketId),
    clientIdx: index("tickets_client_id_idx").on(table.clientId),
  }),
);

// Near-clone of `comments` with contentId -> ticketId. Kept as a separate
// table rather than making `comments` polymorphic — comments.contentId is
// NOT NULL + cascade-FK'd, live in studio/[contentId]; a parallel table is
// zero-risk additive (see jira-confluence-plan.md T2 design decision).
export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("ticket_comments_workspace_id_idx").on(
      table.workspaceId,
    ),
    ticketIdx: index("ticket_comments_ticket_id_idx").on(table.ticketId),
  }),
);

// ---------------------------------------------------------------------------
// Ticket activity log (T3). Append-only audit trail across every ticket
// mutation — the structural gap the T1/T2 exploration flagged (no
// cross-object activity log anywhere in the app). Logged only on the
// winning path of each mutation (after a guard-in-WHERE confirms rows
// affected, or after a successful insert), wrapped in try/catch by the
// caller so a logging failure never masks the primary mutation result
// (same idiom as F1's report-send-log handling).
// ---------------------------------------------------------------------------

export const ticketActivityKind = pgEnum("ticket_activity_kind", [
  "created",
  "status_changed",
  "assigned",
  "commented",
  "edited",
  "labeled",
  "mentioned",
]);

export const ticketActivity = pgTable(
  "ticket_activity",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    kind: ticketActivityKind("kind").notNull(),
    // Shape varies by kind: {from?, to?} for status_changed,
    // {assigneeId?} for assigned, {labels?} for labeled,
    // {mentionedUserId?} for mentioned. Nullable for kinds needing no detail.
    detail: jsonb("detail").$type<{
      from?: string;
      to?: string;
      assigneeId?: string | null;
      labels?: string[];
      mentionedUserId?: string;
    }>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("ticket_activity_workspace_id_idx").on(
      table.workspaceId,
    ),
    ticketIdx: index("ticket_activity_ticket_id_idx").on(table.ticketId),
  }),
);

// ---------------------------------------------------------------------------
// Automation rules engine (A1). Config + audit-trail pair modeled on
// harness_rules/pattern_runs, but MANY rules per workspace (no
// one-per-workspace unique index) and a small closed typed-union
// trigger/action shape — same idiom as HarnessSegment, not a DSL. Run status
// REUSES pattern_run_status (queued/running/done/failed) — no duplicate
// enum. Deterministic condition-checking only: no AI/router calls anywhere
// in this engine (constitution: keeps automation out of AI-cost territory).
// ---------------------------------------------------------------------------

/**
 * Closed typed union, stored as jsonb — mirrors HarnessSegment. Each kind
 * carries the raw days/hours the pure planner (src/lib/automation.ts)
 * converts to an absolute cutoff timestamp.
 */
export type AutomationTrigger =
  | { kind: "idea_stale"; days: number } // ideas.status="new" && createdAt < cutoff
  | { kind: "approval_stale"; hours: number } // hubApprovals.status="pending" && createdAt < cutoff
  | { kind: "ticket_unassigned"; hours: number } // tickets.priority="high" && assigneeId IS NULL && status!="done" && createdAt < cutoff
  | { kind: "event"; verb: string; filter?: Record<string, unknown> }; // Reactive event-triggered rules

export type AutomationAction =
  | { kind: "create_ticket"; title: string; priority: "high" | "medium" | "low" }
  | { kind: "hub_message"; body: string }
  | { kind: "hub_reminder"; title: string; hoursFromNow: number; ownerId: string }
  | { kind: "email"; subject: string; body: string; audience: "team" };

export const automationCadence = pgEnum("automation_cadence", [
  "hourly",
  "daily",
]);

export const automationRules = pgTable(
  "automation_rules",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    action: jsonb("action").$type<AutomationAction>().notNull(),
    cadence: automationCadence("cadence").notNull().default("daily"),
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { mode: "date" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    // No unique-per-workspace index — unlike harnessRules, many automation
    // rules are allowed per workspace.
    workspaceIdx: index("automation_rules_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    status: patternRunStatus("status").notNull().default("queued"),
    matched: integer("matched").notNull().default(0),
    acted: integer("acted").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("automation_runs_workspace_id_idx").on(
      table.workspaceId,
    ),
    ruleIdx: index("automation_runs_rule_id_idx").on(table.ruleId),
  }),
);

// ---------------------------------------------------------------------------
// Internal docs (D1). Lightweight authored workspace docs — explicitly
// distinct from knowledge_sources/knowledge_chunks (the client-scoped RAG
// ingestion vault: URLs the client pastes in, chunked + embedded, fed to
// the AI router for retrieval). workspace_docs are workspace-scoped (not
// client-scoped), hand-authored by the team, and never touch the AI router
// or the ingestion pipeline — pure internal reference material (runbooks,
// SOPs, notes), same spirit as a lightweight Confluence page.
// Version history is intentionally deferred for v1 — a single mutable
// `body` + `updatedAt`/`updatedById` is the whole feature. A full page
// history is a separate future feature, not built here.
//
// V2 (SOP layer): `kind` distinguishes an authored SOP from a general doc.
// Deliberately NOT a parallel table — an SOP is just a workspace_doc marked
// kind="sop" (counterattack-09-fragmentation.md Phase V's hard rule: no new
// table overlapping an existing concept). Kept to the kind distinction only
// — no category/tags, no version/approval flow in this slice.
// ---------------------------------------------------------------------------

export const docKind = pgEnum("doc_kind", ["doc", "sop", "auto"]);

export const workspaceDocs = pgTable(
  "workspace_docs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // URL-safe, derived from title at create time via slugify() (src/lib/validation.ts).
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown source
    kind: docKind("kind").notNull().default("doc"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    updatedById: text("updated_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("workspace_docs_workspace_id_idx").on(
      table.workspaceId,
    ),
    // Slug uniqueness is PER WORKSPACE, not global — two workspaces may each
    // have a doc at slug "onboarding".
    slugUnique: uniqueIndex("workspace_docs_workspace_slug_unique").on(
      table.workspaceId,
      table.slug,
    ),
  }),
);

// ---------------------------------------------------------------------------
// S1 — SOP templates. A template is not a document: it's the definition of a
// dated, assigned, dependency-ordered run (see sop_runs in S2). This is
// deliberately a real table pair, not a `workspace_docs.kind` flag — a doc's
// markdown body cannot hold a queryable assignee, due-date offset, gate, or
// dependency graph.
//
// Templates and runs share ONE nav entry ("SOPs", two tabs), not two. The
// fragmentation to guard against is the three-disconnected-boards problem,
// and the fix for that is that a run's steps LINK INTO existing
// tickets/approvals/content rather than becoming a fourth place work hides.
// Giving the product's headline feature one discoverable home is not that
// failure; burying it under Docs would just make it undiscoverable.
// ---------------------------------------------------------------------------

export const sopStepGate = pgEnum("sop_step_gate", [
  "none",
  "approval",
  "compliance",
]);

export const sopStepCreates = pgEnum("sop_step_creates", [
  "none",
  "task",
  "content",
  "ticket",
  "doc",
]);

export const sopTemplates = pgTable(
  "sop_templates",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** What kind of work a run creates steps for — optional: a template can
     *  stay generic (e.g. "monthly content cycle") without picking one. */
    workTypeId: text("work_type_id").references(() => workTypes.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    /** What the run's one date input is called — "Launch date", "Go-live",
     *  "Publish date". Every step's due date is an offset from it. */
    anchorLabel: text("anchor_label").notNull().default("Anchor date"),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("sop_templates_workspace_id_idx").on(
      table.workspaceId,
    ),
  }),
);

/** Who a run-step is assigned to once instantiated. "role" resolves against
 *  the run's own client/workspace at instantiation time (S2); "user" is a
 *  specific member chosen at template-authoring time. */
export type SopAssigneeRule =
  | { kind: "role"; value: (typeof membershipRole.enumValues)[number] }
  | { kind: "user"; value: string }
  | { kind: "unassigned" };

export type StepCompletionPolicy =
  | { kind: "manual" }
  | { kind: "linked_state"; state: string }
  | { kind: "linked_closed" };

export const sopSteps = pgTable(
  "sop_steps",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => sopTemplates.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    assigneeRule: jsonb("assignee_rule")
      .$type<SopAssigneeRule>()
      .notNull()
      .default(sql`'{"kind":"unassigned"}'::jsonb`),
    /** Days from the run's anchor date; negative = before it. */
    dueOffsetDays: integer("due_offset_days").notNull().default(0),
    gate: sopStepGate("gate").notNull().default("none"),
    creates: sopStepCreates("creates").notNull().default("none"),
    /** Policy governing automatic completion when linked items change. */
    completesWhen: jsonb("completes_when")
      .$type<StepCompletionPolicy>()
      .notNull()
      .default(sql`'{"kind":"manual"}'::jsonb`),
    /** Sibling sop_step ids within the same template. Not a FK array — like
     *  tickets.labels, dependency membership is validated at the app layer
     *  (same template, no cycles), not by Postgres. */
    dependsOn: text("depends_on")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("sop_steps_workspace_id_idx").on(table.workspaceId),
    templateIdx: index("sop_steps_template_id_idx").on(table.templateId),
  }),
);

// ---------------------------------------------------------------------------
// S2 — runs. A run is a SNAPSHOT, not a live view of its template: title,
// gate, offset and dependencies are copied in at instantiation. Editing a
// template must never silently rewrite work already underway, and deleting
// one must not strand a run mid-flight — which is also why template_id is
// `set null` rather than `cascade`, and why every field a run needs to
// render is stored on the run's own rows.
// ---------------------------------------------------------------------------

export const sopRunStatus = pgEnum("sop_run_status", [
  "active",
  "completed",
  "cancelled",
]);

/**
 * `blocked` is derived, never chosen: a step is blocked exactly while some
 * dependency of it is not yet done. `skipped` is the honest escape hatch for
 * a step that turned out not to apply — closing it as `done` would inflate
 * completion metrics with work nobody did.
 */
export const sopRunStepStatus = pgEnum("sop_run_step_status", [
  "blocked",
  "ready",
  "in_progress",
  "done",
  "skipped",
]);

export const sopRuns = pgTable(
  "sop_runs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    templateId: text("template_id").references(() => sopTemplates.id, {
      onDelete: "set null",
    }),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** The one date everything else is measured from. Day granularity: a
     *  step is due on a day, not at a minute. */
    anchorDate: timestamp("anchor_date", { mode: "date" }).notNull(),
    status: sopRunStatus("status").notNull().default("active"),
    startedById: text("started_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (table) => ({
    workspaceIdx: index("sop_runs_workspace_id_idx").on(table.workspaceId),
    statusIdx: index("sop_runs_status_idx").on(table.workspaceId, table.status),
  }),
);

export const sopRunSteps = pgTable(
  "sop_run_steps",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => sopRuns.id, { onDelete: "cascade" }),
    /** Which template step this came from — provenance only. Null once that
     *  template step is deleted; the run keeps running regardless. */
    templateStepId: text("template_step_id"),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    /** Resolved at instantiation. Null when the template asked for a ROLE
     *  rather than a person — see assigneeRole. */
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * The role the template asked for, kept when no specific person was
     * named. A role rule deliberately does NOT auto-pick someone: handing
     * work to an arbitrary admin who never agreed to it is worse than
     * showing "needs an admin" and letting a human choose.
     */
    assigneeRole: membershipRole("assignee_role"),
    dueAt: timestamp("due_at", { mode: "date" }).notNull(),
    status: sopRunStepStatus("status").notNull().default("ready"),
    gate: sopStepGate("gate").notNull().default("none"),
    creates: sopStepCreates("creates").notNull().default("none"),
    /** Policy governing automatic completion when linked items change. */
    completesWhen: jsonb("completes_when")
      .$type<StepCompletionPolicy>()
      .notNull()
      .default(sql`'{"kind":"manual"}'::jsonb`),
    /** Sibling sop_run_step ids — REMAPPED from template step ids at
     *  instantiation. A run's graph points inside itself, so editing the
     *  template later can't reroute work already in flight. */
    dependsOn: text("depends_on")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The row this step brought into existence, once it has (S4). */
    linkedType: text("linked_type"),
    linkedId: text("linked_id"),
    rejectionReason: text("rejection_reason"),
    completedAt: timestamp("completed_at", { mode: "date" }),
    completedById: text("completed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("sop_run_steps_workspace_id_idx").on(table.workspaceId),
    runIdx: index("sop_run_steps_run_id_idx").on(table.runId),
    assigneeIdx: index("sop_run_steps_assignee_idx").on(
      table.workspaceId,
      table.assigneeId,
    ),
  }),
);

export const sopSuggestions = pgTable(
  "sop_suggestions",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sopTemplateId: text("sop_template_id").references(() => sopTemplates.id, {
      onDelete: "cascade",
    }),
    runId: text("run_id").references(() => sopRuns.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull().default("template_improvement"),
    scopedRunHash: text("scoped_run_hash"),
    reason: text("reason").notNull(),
    suggestedChanges: jsonb("suggested_changes")
      .$type<Record<string, unknown>>()
      .notNull(),
    appliedAt: timestamp("applied_at", { mode: "date" }),
    dismissedAt: timestamp("dismissed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("sop_suggestions_workspace_id_idx").on(table.workspaceId),
  }),
);

// ---------------------------------------------------------------------------
// Cost telemetry (Phase 5). One row per routeAI call. workspace_id is null
// for system calls made outside a runWithAiCost context; the daily cap and
// cockpit only ever read workspace-scoped rows.
// ---------------------------------------------------------------------------

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    kind: text("kind").notNull(), // chat | embed
    tier: text("tier"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    purpose: text("purpose"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("ai_usage_workspace_id_idx").on(table.workspaceId),
    createdIdx: index("ai_usage_created_at_idx").on(table.createdAt),
  }),
);

/**
 * Tables carrying tenant data. Every one of these MUST have a workspace_id
 * column — enforced by test in src/db/schema.test.ts (constitution rule:
 * workspace_id isolation on every table, every query).
 */
export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull(),
    cadence: text("cadence").notNull().default("weekly"),
    lastSentAt: timestamp("last_sent_at", { mode: "date" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("report_schedules_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("report_schedules_client_id_idx").on(table.clientId),
  }),
);

// ---------------------------------------------------------------------------
// Phase 2 — Personal chat / DM subsystem
// ---------------------------------------------------------------------------

export const conversationType = pgEnum("conversation_type", [
  "direct",
  "group",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: conversationType("type").notNull().default("direct"),
    title: text("title"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index("conversations_workspace_id_idx").on(table.workspaceId),
  }),
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { mode: "date" }),
    joinedAt: timestamp("joined_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.userId] }),
    userConversationIdx: index("conversation_participants_user_idx").on(
      table.userId,
    ),
  }),
);

export const directMessages = pgTable(
  "direct_messages",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<Record<string, unknown>[]>(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index("direct_messages_conversation_id_idx").on(
      table.conversationId,
    ),
    createdIdx: index("direct_messages_created_at_idx").on(table.createdAt),
  }),
);

export const assetKind = pgEnum("asset_kind", ["csv", "doc", "image", "other"]);

/**
 * Workspace file storage. The row is the record of truth; the bytes live in
 * a private Supabase Storage bucket at `storage_path`.
 *
 * `client_id` is nullable and ON DELETE SET NULL, not CASCADE: deleting a
 * client must not silently destroy files a team still needs. They become
 * workspace-level assets instead, and stay visible.
 *
 * `linked_type` / `linked_id` are the same untyped polymorphic pair used by
 * `tickets` and `sop_run_steps`. Unused in Slice 1 — they exist so Slice 3
 * (attachments on tickets, DMs, drafts) is a query change, not a migration.
 *
 * Deletion is soft (`archived_at`). Storage bytes ARE removed on archive;
 * the row survives so an audit can still answer "who uploaded what, when".
 */
export const assets = pgTable(
  "assets",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    uploadedById: text("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    // Display name, sanitised via safeFilename(). Never used to build a path.
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    // `ws/{workspace_id}/{asset_id}` — see storagePathFor() in src/lib/assets.ts.
    storagePath: text("storage_path").notNull(),
    kind: assetKind("kind").notNull().default("other"),
    linkedType: text("linked_type"),
    linkedId: text("linked_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
  },
  (table) => ({
    workspaceIdx: index("assets_workspace_id_idx").on(table.workspaceId),
    clientIdx: index("assets_client_id_idx").on(table.clientId),
    linkedIdx: index("assets_linked_idx").on(
      table.workspaceId,
      table.linkedType,
      table.linkedId,
    ),
    // One row per object. Makes an orphaned double-insert impossible.
    storagePathUnique: uniqueIndex("assets_storage_path_unique").on(
      table.storagePath,
    ),
  }),
);

export const workspaceScopedTables = {
  memberships,
  clients,
  clientGoals,
  content,
  campaigns,
  importJobs,
  posts,
  postEmbeddings,
  connectedAccounts,
  patternPosts,
  patternProfiles,
  patternComments,
  patternAds,
  brandProfiles,
  knowledgeSources,
  knowledgeChunks,
  ideas,
  schedule,
  harnessRules,
  patternRuns,
  insights,
  decisions,
  comments,
  hubMessages,
  hubApprovals,
  hubTasks,
  hubReminders,
  reportSends,
  reportSchedules,
  tickets,
  ticketComments,
  ticketActivity,
  automationRules,
  automationRuns,
  workspaceDocs,
  workTypes,
  workflows,
  workflowStates,
  workflowTransitions,
  sopTemplates,
  sopSteps,
  sopRuns,
  sopRunSteps,
  sopSuggestions,
  conversations,
  assets,
} as const;

