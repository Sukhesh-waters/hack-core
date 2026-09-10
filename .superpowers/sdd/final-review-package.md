# Final whole-branch review package

Diff is 60,064 lines across 24 commits — too large to read linearly.
This package gives full commit history + targeted evidence per the
plan's 5 named risk priorities. Use it to verify systematically;
read individual files directly for anything that looks wrong.

## All commits in this wave (24e94d0..HEAD)
7d8ef18 chore: ledger — Task 6 fix wave complete, 864 tests
b9fd047 fix: Task 6 — clear the 12-item Minor findings backlog in one pass
dc6646f chore: ledger — Task 5 browser pass complete, all flows verified
3991460 feat(u7): wire saved plan-grid views to the UI
8ebd980 feat(f5): custom fields render and edit as grid columns
23022d3 chore: ledger — handoff Tasks 1-2 complete
52fbe43 test(u4): cover loadRowDetailAction and addPlanRowCommentAction
fd06ab8 docs: handoff plan to completion for the implementing agent
28ccc7c chore: ledger — wave 3 salvaged and committed
326677c feat(f4): user-defined fields render and save on a content row
2c24c68 feat(u5/u6): multi-select bulk edit and spreadsheet keyboard layer
4e924f4 feat(u9): inline Jira-style status control for hub tasks
f00a3f2 chore: ledger — U8 complete, F4 dispatched
b3c6516 chore: ledger — U4 reviewed, F3 complete, wave 3 dispatched
d8b8c11 test: cover the transaction and cross-tenant paths guard-clause tests missed
dd329f8 chore: ledger — F3 reviewed, test-gap fix dispatched
40b1702 feat(u8): one workflow-respecting status menu for Ideation and Plan & Validate
63cdfe1 feat(u4): calendar row detail panel — Jira-style edit without losing your place
808f625 chore: ledger — F3 built, review dispatched
f56e5d5 feat(f3): custom field admin UI — create, reuse across types, archive
c0f11f2 chore: ledger — wave 2 dispatched
1eed0f6 feat(u7): saved plan-grid view per person per workspace
b79f631 chore: sdd ledger — U1/U2/U3/F1/F2 complete
e75ab97 feat(f2): custom-field definitions, assignments and value store
8905dc1 feat(u2/u3): plan grid scope switcher and grouped sections
df46ef7 feat(production): Jira-style inline status transition menu
1d59a62 feat(f1): custom-field type registry and validation
9fa4f3c feat(u2): plan-grid scope filters and grouping primitives
d29b2fe docs: ops-UX plan, owner decisions logged
a74f5db fix(s10): stop emailing the whole workspace about one person's work
a39d5f0 feat(s7): "My work" — one page for what's assigned to me
88382ef feat(s8): atomic push to team
d3ddc18 docs: phase 3 underway, S6 and S9 shipped
9d91050 feat(s9): in-app notification centre
337bc6e feat(s6): universal activity log
acd7a79 fix(s2): switching a video row to a non-video type was rejected
2afb600 docs: phases 1 and 2 complete
8c339ce feat(s5): compare and apply drawer for plan revisions
a4b5692 feat(s3): per-row Ask AI, proposing without applying
d7b53d5 docs: track ops-layer slice progress
64caa11 feat(s4): content_revisions — proposals before they become the plan
1623348 feat(s2): plan grid view for the calendar
9d45b8e fix(g1a): seed-draft revalidation and race guard
3b0cc64 feat(s1): extend content model with plan-grid fields

## Full file stat
 .superpowers/sdd/agent-a-report.md                 |  103 +
 .superpowers/sdd/agent-b-report.md                 |   77 +
 .superpowers/sdd/agent-c-report.md                 |   49 +
 .superpowers/sdd/agent-d-report.md                 |  101 +
 .superpowers/sdd/agent-e-report.md                 |  113 +
 .superpowers/sdd/agent-g-report.md                 |   24 +
 .superpowers/sdd/f3-review-package.md              | 1005 ++++
 .superpowers/sdd/progress.md                       |  148 +
 .superpowers/sdd/u1-review-package.md              |  438 ++
 .superpowers/sdd/u2u3-review-package.md            |  573 ++
 .superpowers/sdd/u4-review-package.md              |  893 +++
 .superpowers/sdd/u8-review-package.md              |  945 +++
 .superpowers/sdd/u9-review-package.md              |  889 +++
 PLAN-OPS-LAYER.md                                  |  187 +
 PLAN-OPS-UX-REMAINING.md                           |  345 ++
 PLAN-OPS-UX.md                                     |  150 +
 drizzle/0028_steep_red_skull.sql                   |   11 +
 drizzle/0029_soft_warbound.sql                     |   21 +
 drizzle/0030_flowery_tony_stark.sql                |   17 +
 drizzle/0031_little_dakota_north.sql               |   16 +
 drizzle/0032_cool_war_machine.sql                  |    2 +
 drizzle/0033_colossal_cardiac.sql                  |   32 +
 drizzle/0034_awesome_vampiro.sql                   |   17 +
 drizzle/meta/0028_snapshot.json                    | 5193 +++++++++++++++++
 drizzle/meta/0029_snapshot.json                    | 5366 +++++++++++++++++
 drizzle/meta/0030_snapshot.json                    | 5520 ++++++++++++++++++
 drizzle/meta/0031_snapshot.json                    | 5653 ++++++++++++++++++
 drizzle/meta/0032_snapshot.json                    | 5670 ++++++++++++++++++
 drizzle/meta/0033_snapshot.json                    | 5961 +++++++++++++++++++
 drizzle/meta/0034_snapshot.json                    | 6106 ++++++++++++++++++++
 drizzle/meta/_journal.json                         |   49 +
 src/app/(app)/w/[ws]/approvals/actions.ts          |    9 +
 src/app/(app)/w/[ws]/calendar/actions.test.ts      |  256 +
 src/app/(app)/w/[ws]/calendar/actions.ts           |  816 ++-
 .../w/[ws]/calendar/custom-field-actions.test.ts   |  191 +
 .../(app)/w/[ws]/calendar/custom-field-actions.ts  |  102 +
 src/app/(app)/w/[ws]/calendar/detail-panel.tsx     |  618 ++
 src/app/(app)/w/[ws]/calendar/page.tsx             |  276 +-
 src/app/(app)/w/[ws]/calendar/plan-grid.tsx        | 1155 ++++
 src/app/(app)/w/[ws]/calendar/revision-drawer.tsx  |  214 +
 src/app/(app)/w/[ws]/calendar/view-actions.test.ts |  123 +
 src/app/(app)/w/[ws]/calendar/view-actions.ts      |   74 +
 src/app/(app)/w/[ws]/calendar/view-controls.tsx    |  327 ++
 src/app/(app)/w/[ws]/fields/actions.test.ts        |  380 ++
 src/app/(app)/w/[ws]/fields/actions.ts             |  258 +
 src/app/(app)/w/[ws]/fields/field-admin.tsx        |  399 ++
 src/app/(app)/w/[ws]/fields/page.tsx               |   72 +
 src/app/(app)/w/[ws]/hub/actions.ts                |   73 +-
 src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx       |  219 +-
 src/app/(app)/w/[ws]/ideation/actions.ts           |   39 +-
 src/app/(app)/w/[ws]/ideation/idea-card.tsx        |  121 +-
 src/app/(app)/w/[ws]/layout.tsx                    |    2 +
 src/app/(app)/w/[ws]/my-work/page.tsx              |   85 +
 src/app/(app)/w/[ws]/plan/actions.ts               |    2 +-
 src/app/(app)/w/[ws]/plan/page.tsx                 |    3 +
 src/app/(app)/w/[ws]/plan/plan-card.tsx            |  124 +-
 src/app/(app)/w/[ws]/production/actions.ts         |    2 +-
 .../(app)/w/[ws]/production/production-card.tsx    |  106 +-
 src/app/(app)/w/[ws]/reports/actions.ts            |    7 +-
 src/app/(app)/w/[ws]/studio/[contentId]/actions.ts |   78 +-
 src/app/(app)/w/[ws]/studio/[contentId]/page.tsx   |   24 +
 .../[ws]/studio/[contentId]/push-to-team-form.tsx  |   95 +
 src/components/custom-field-input.tsx              |  332 ++
 src/components/notification-actions.ts             |   76 +
 src/components/notification-bell.tsx               |  160 +
 src/components/reject-reason-panel.tsx             |   60 +
 src/components/transition-menu.tsx                 |  210 +
 src/components/workspace-nav.tsx                   |   14 +-
 src/db/queries/comments.ts                         |   10 +-
 src/db/queries/custom-fields.test.ts               |   71 +
 src/db/queries/custom-fields.ts                    |  122 +
 src/db/queries/hub.ts                              |   16 -
 src/db/queries/memberships.test.ts                 |   43 +-
 src/db/queries/memberships.ts                      |   59 +-
 src/db/queries/my-work.test.ts                     |  108 +
 src/db/queries/my-work.ts                          |  128 +
 src/db/queries/notifications.test.ts               |   77 +
 src/db/queries/notifications.ts                    |  121 +
 src/db/queries/plan-views.test.ts                  |   22 +
 src/db/queries/plan-views.ts                       |   96 +
 src/db/queries/production.test.ts                  |   36 +-
 src/db/queries/production.ts                       |   47 +-
 src/db/queries/revisions.test.ts                   |   76 +
 src/db/queries/revisions.ts                        |  205 +
 src/db/queries/schedule.test.ts                    |  114 +
 src/db/queries/schedule.ts                         |  233 +-
 src/db/queries/tickets.ts                          |   13 +
 src/db/schema.ts                                   |  335 ++
 src/inngest/functions/automation.ts                |   19 +-
 src/inngest/functions/reminders.ts                 |   33 +-
 src/lib/activity-query.test.ts                     |   34 +
 src/lib/activity.test.ts                           |   99 +
 src/lib/activity.ts                                |   89 +
 src/lib/ai/budget.test.ts                          |    8 +-
 src/lib/ai/budget.ts                               |    6 +-
 src/lib/colors.ts                                  |    3 +
 src/lib/custom-fields.test.ts                      |  204 +
 src/lib/custom-fields.ts                           |  265 +
 src/lib/grid-keys.test.ts                          |  211 +
 src/lib/grid-keys.ts                               |  135 +
 src/lib/hub-workflow.test.ts                       |  117 +
 src/lib/hub-workflow.ts                            |  102 +
 src/lib/idea-workflow.test.ts                      |  116 +
 src/lib/idea-workflow.ts                           |   87 +
 src/lib/nav.test.ts                                |    7 +-
 src/lib/nav.ts                                     |    4 +
 src/lib/plan-cell.test.ts                          |   54 +
 src/lib/plan-cell.ts                               |   54 +
 src/lib/plan-view.test.ts                          |  328 ++
 src/lib/plan-view.ts                               |  283 +
 src/lib/plan/accept-idea.ts                        |   13 +
 src/lib/plan/apply-fields.test.ts                  |  173 +
 src/lib/plan/apply-fields.ts                       |  145 +
 src/lib/plan/push-to-team.test.ts                  |  180 +
 src/lib/plan/push-to-team.ts                       |  168 +
 src/lib/plan/suggest-row.test.ts                   |  235 +
 src/lib/plan/suggest-row.ts                        |  189 +
 src/lib/production.test.ts                         |   60 +
 src/lib/production.ts                              |   51 +
 src/lib/reminders.test.ts                          |   22 +
 src/lib/reminders.ts                               |   13 +-
 src/lib/validation.test.ts                         |   71 +
 src/lib/validation.ts                              |   35 +
 yc-application-audit.md                            |   93 +
 124 files changed, 58101 insertions(+), 313 deletions(-)

## RISK 1 — workspace isolation: every UPDATE/DELETE in touched files
Grep for .update( and .delete( calls; each .where( that follows must
contain a workspaceId eq. Spot-check any that don't below.
src/app/(app)/w/[ws]/approvals/actions.ts:48:      .update(content)
src/app/(app)/w/[ws]/calendar/plan-grid.tsx:306:    else cellRefs.current.delete(key);
src/app/(app)/w/[ws]/calendar/plan-grid.tsx:446:        for (const id of result.updated) next.delete(id);
src/app/(app)/w/[ws]/calendar/plan-grid.tsx:478:        next.delete(rowId);
src/app/(app)/w/[ws]/calendar/plan-grid.tsx:491:        for (const r of flatRows) next.delete(r.id);
src/app/(app)/w/[ws]/calendar/revision-drawer.tsx:55:      if (next.has(field)) next.delete(field);
src/app/(app)/w/[ws]/fields/actions.ts:244:      .delete(customFieldAssignments)
src/app/(app)/w/[ws]/hub/actions.ts:198:      .update(hubTasks)
src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx:95:            next.delete(key);
src/app/(app)/w/[ws]/studio/[contentId]/actions.ts:69:      .update(content)
src/app/(app)/w/[ws]/studio/[contentId]/actions.ts:219:      .update(content)
src/app/(app)/w/[ws]/studio/[contentId]/actions.ts:332:      .update(content)
src/db/queries/custom-fields.ts:98:    .update(content)
src/db/queries/custom-fields.ts:112:    .update(customFieldDefinitions)
src/db/queries/hub.ts:152:      .update(hubApprovals)
src/db/queries/hub.ts:169:        .update(campaigns)
src/db/queries/hub.ts:198:    .update(hubTasks)
src/db/queries/notifications.ts:58:    .update(notifications)
src/db/queries/notifications.ts:73:    .update(notifications)
src/db/queries/production.ts:82:    .update(content)
src/db/queries/production.ts:101:    .update(content)
src/db/queries/revisions.ts:188:    .update(contentRevisions)
src/db/queries/schedule.ts:229:    .update(content)
src/db/queries/schedule.ts:270:          .delete(schedule)
src/db/queries/schedule.ts:301:        .update(schedule)
src/db/queries/schedule.ts:390:      .update(content)
src/db/queries/schedule.ts:411:    .update(schedule)
src/db/queries/tickets.ts:146:    .update(tickets)
src/db/queries/tickets.ts:212:    .update(tickets)
src/db/queries/tickets.ts:260:    .update(tickets)
src/db/queries/tickets.ts:274:    .delete(tickets)
src/lib/plan/push-to-team.ts:92:        .update(content)

## RISK 2 — status/complianceStatus/productionStage writability
Every place these three identifiers appear as an object key being SET
(not read) across the whole branch:

+    status: r.status,
+    complianceStatus: r.complianceStatus,
+    productionStage: r.productionStage,
+  status: string;
+  complianceStatus: string;
+  productionStage: string | null;
+ * Deliberately excludes status/complianceStatus/productionStage: those
+    runAction(`task-status:${id}`, () =>
+                    disabled={isBusy(`task-status:${tk.id}`)}
+  status: IdeaStatus;
+    status: "new",
+  status: IdeaStatus;
+  const triggerLabel = `${label ? `${label} — ` : ""}status: ${currentLabel}. Click to change.`;
+    status: "open",
+  status: string;
+      productionStage: content.productionStage,
+      status: tickets.status,
+      status: d.productionStage ?? "brief",
+      status: t.status,
+      status: content.status,
+      complianceStatus: content.complianceStatus,
+      productionStage: content.productionStage,
+export function transitionsForHubTask(status: HubTaskStatus): HubTaskTransition[] {
+  status: HubTaskStatus;
+export function doneFromHubTaskStatus(status: HubTaskStatus): boolean {
+export function transitionsForIdea(status: IdeaStatus): IdeaTransition[] {
+  status: IdeaStatus;
+  { slug: "my-work", label: "My work", group: "Operate", status: "live" },
+  { slug: "fields", label: "Fields", group: "Infrastructure", status: "live" },
+    status: string,
+  status: string;
+        status: "approved",
+        productionStage: "done",
+  productionStage: null,
+      productionStage: content.productionStage,
+            ? { productionStage: "brief" as const }

## RISK 3 — custom-field injection guard
Every write to a customFields / custom_fields column, and every place
a fieldId is looked up before use:
src/app/(app)/w/[ws]/calendar/custom-field-actions.ts:31: * Writes ONE custom field's value onto a content row's `customFields` jsonb.
src/app/(app)/w/[ws]/calendar/custom-field-actions.ts:39: *    crafted request stash an arbitrary jsonb key under customFields —
src/app/(app)/w/[ws]/calendar/custom-field-actions.ts:41: * 2. The write MERGES into the row's existing customFields rather than
src/app/(app)/w/[ws]/calendar/custom-field-actions.ts:82:    const existing = (row.customFields ?? {}) as Record<string, unknown>;
src/app/(app)/w/[ws]/calendar/page.tsx:39: * customFields column (it's a hand-picked set of plan-cell fields), so this
src/app/(app)/w/[ws]/calendar/page.tsx:50:    .select({ id: content.id, customFields: content.customFields })
src/app/(app)/w/[ws]/calendar/page.tsx:56:    byId[row.id] = (row.customFields ?? {}) as Record<string, unknown>;
src/app/(app)/w/[ws]/calendar/page.tsx:308:            customFields={customFieldDefinitions.map((d) => ({
src/app/(app)/w/[ws]/calendar/view-controls.tsx:84:  customFields = [],
src/app/(app)/w/[ws]/calendar/view-controls.tsx:97:  customFields?: ViewControlsCustomField[];
src/app/(app)/w/[ws]/calendar/view-controls.tsx:276:      {customFields.length > 0 ? (
src/app/(app)/w/[ws]/calendar/view-controls.tsx:292:              {customFields.map((field) => {
src/db/schema.ts:294:    customFields: jsonb("custom_fields").$type<Record<string, unknown>>(),
src/db/schema.ts:370:// (see content.customFields), which avoids a join on every read. EAV would
src/db/queries/custom-fields.ts:99:    .set({ customFields: input.merged })

## RISK 4 — unbounded queries
Every .select(/.query in touched files WITHOUT a nearby .limit(:
--- src/db/queries/comments.ts ---
5:export function commentsForContentQuery(
29:export async function listComments(workspaceId: string, contentId: string) {
33:export async function addComment(input: {
--- src/db/queries/custom-fields.ts ---
25:export function fieldsForSubjectQuery(
55:export async function listFieldsForSubject(
71:export function allFieldsQuery(workspaceId: string) {
92:export function setContentCustomFieldsQuery(input: {
110:export function archiveFieldQuery(workspaceId: string, fieldId: string) {
--- src/db/queries/hub.ts ---
16:export function hubMessagesQuery(workspaceId: string) {
35:export function hubApprovalsQuery(workspaceId: string) {
53:export function hubTasksQuery(workspaceId: string) {
62:export function hubRemindersQuery(workspaceId: string) {
78:export function workspaceMembersQuery(workspaceId: string) {
87:export function ideasQuickViewQuery(workspaceId: string) {
101:export async function getHubState(workspaceId: string) {
114:export async function addHubTextMessage(input: {
122:export async function createHubApproval(input: {
144:export async function decideHubApproval(input: {
184:export async function addHubTask(input: {
192:export async function setHubTaskPriority(input: {
208:export async function addHubReminder(input: {
--- src/db/queries/memberships.ts ---
9:export async function getMembership(workspaceId: string, userId: string) {
23:export async function requireMembership(workspaceId: string, userId: string) {
48:export function emailsForUsersQuery(workspaceId: string, userIds: string[]) {
63:export async function emailsForUsers(
73:export function immediateMemberEmailsQuery(workspaceId: string) {
87:export async function listImmediateMemberEmails(
97:export function workspaceMembersQuery(workspaceId: string) {
105:export async function listWorkspaceMembers(workspaceId: string) {
110:export async function listWorkspacesForUser(userId: string) {
--- src/db/queries/my-work.ts ---
21:export function myContentQuery(workspaceId: string, userId: string) {
45:export function myTicketsQuery(workspaceId: string, userId: string) {
78:export async function listMyWork(
118:export function sortMyWork(items: MyWorkItem[]): MyWorkItem[] {
--- src/db/queries/notifications.ts ---
20:export function unreadCountQuery(workspaceId: string, userId: string) {
33:export function notificationsQuery(workspaceId: string, userId: string) {
52:export function markReadQuery(input: {
71:export function markAllReadQuery(workspaceId: string, userId: string) {
99:export async function notify(
114:export async function listNotifications(workspaceId: string, userId: string) {
118:export async function getUnreadCount(workspaceId: string, userId: string) {
--- src/db/queries/plan-views.ts ---
19:export function planViewQuery(workspaceId: string, userId: string) {
40:export async function getSavedPlanView(
59:export async function savePlanView(input: {
--- src/db/queries/production.ts ---
9:export function productionQueueQuery(workspaceId: string) {
34:export async function listProductionQueue(workspaceId: string) {
41:export async function createProductionCard(input: {
76:export function seedDraftBodyQuery(input: {
94:export function advanceStageQuery(input: {
118:export async function advanceStage(input: {
--- src/db/queries/revisions.ts ---
14:export function revisionsForContentQuery(
45:export function pendingRevisionsQuery(workspaceId: string, contentId: string) {
71:export function pendingRevisionCountsQuery(
93:export function pendingRevisionsForContentsQuery(
119:export async function pendingRevisionsForContents(
127:export async function pendingRevisionCounts(
136:export function getRevisionQuery(workspaceId: string, revisionId: string) {
149:export async function recordRevision(input: {
182:export function markRevisionAppliedQuery(input: {
200:export async function listRevisionsForContent(
--- src/db/queries/schedule.ts ---
30:export function approvalQueueQuery(workspaceId: string) {
57:export function scheduledSlotsQuery(
96:export function dueRemindersQuery(dueBefore: Date) {
121:export async function listApprovalQueue(workspaceId: string) {
125:export async function listScheduledSlots(
148:export function planGridQuery(
223:export function updatePlanCellQuery(input: {
248:export async function setPlanSlot(input: {
318:export async function listPlanGrid(
334:export async function createScheduledPost(input: {
379:export async function scheduleContent(input: {
409:export async function markReminderSent(scheduleId: string, sentAt: Date) {
--- src/db/queries/tickets.ts ---
32:export function ticketsQuery(
74:export async function listTickets(
81:export async function getTicket(workspaceId: string, ticketId: string) {
90:export async function createTicket(input: {
139:export function advanceTicketStatusQuery(input: {
158:export async function advanceTicketStatus(input: {
206:export function assignTicketQuery(
218:export async function assignTicket(
254:export function updateTicketFieldsQuery(
272:export function deleteTicketQuery(workspaceId: string, ticketId: string) {
279:export async function deleteTicket(workspaceId: string, ticketId: string) {
287:export async function updateTicketFields(

## RISK 5 — non-static Tailwind (template-built class strings)
Any className/cn() using template literals with a variable inside:
(empty above = clean)
