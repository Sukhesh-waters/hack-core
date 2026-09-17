import type { membershipRole } from "@/db/schema";

export type MembershipRole = (typeof membershipRole.enumValues)[number];

/**
 * P1 — what each role may do.
 *
 * A static matrix, deliberately not a table. Custom per-workspace roles are
 * a different product: they turn every permission question into a runtime
 * lookup nobody can audit, and they cannot be unit-tested exhaustively. A
 * fixed matrix can, and the test below walks every role × capability pair.
 *
 * This exists because a workflow builder without permissions is decoration.
 * Once an admin can edit states and transitions, "who may edit them" and
 * "who may skip the approval gate they are subject to" stop being
 * theoretical.
 */
export const CAPABILITIES = [
  "workflow.edit",
  "workflow.force",
  "sop.template.edit",
  "sop.run.start",
  "approval.decide",
  "field.edit",
  "member.invite",
  "client.manage",
  "asset.upload",
  "asset.delete",
  "gate.declare",
  "gate.confirm",
  "gate.approve",
  "gate.publish",
  "platina.task.edit",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  "workflow.edit": "Edit workflows",
  "workflow.force": "Force a transition past the workflow",
  "sop.template.edit": "Edit SOP templates",
  "sop.run.start": "Start an SOP run",
  "approval.decide": "Approve or reject content",
  "field.edit": "Create and edit custom fields",
  "member.invite": "Invite members",
  "client.manage": "Add and edit clients",
  "asset.upload": "Upload files to the workspace",
  "asset.delete": "Archive workspace files",
  "gate.declare": "Declare a brand standard (Gate 1)",
  "gate.confirm": "Confirm a scan spec before fetch (Gate 2)",
  "gate.approve": "Approve a campaign direction (Gate 3)",
  "gate.publish": "Approve a campaign to ship (Gate 4)",
  "platina.task.edit": "Work on Platina solution tasks",
};

/**
 * Owner and admin differ nowhere yet, and that is recorded rather than
 * collapsed: keeping them distinct means the day one capability needs to be
 * owner-only (billing, deleting a workspace) it is a one-line change here
 * instead of a role split across the codebase.
 *
 * Member is the interesting row. A member does the work — they start SOP
 * runs and move cards through the workflow — but they cannot rewrite the
 * process itself, force a card past a gate, or decide their own approvals.
 * That separation is the entire point of the matrix.
 */
const MATRIX: Record<MembershipRole, readonly Capability[]> = {
  owner: [...CAPABILITIES],
  admin: [...CAPABILITIES],
  // A member does the work: they start runs and upload the client's files.
  // They do not archive files — that destroys bytes and is not reversible.
  member: ["sop.run.start", "asset.upload", "platina.task.edit"],
};

export function roleCan(role: MembershipRole, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

/** Every capability a role holds — for rendering a permissions screen. */
export function capabilitiesFor(role: MembershipRole): Capability[] {
  return [...MATRIX[role]];
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export class PermissionError extends Error {
  constructor(public readonly capability: Capability) {
    super(PERMISSION_MESSAGES[capability]);
    this.name = "PermissionError";
  }
}

/**
 * Refusals name the thing the person tried to do, not their role. "You need
 * an admin to change the workflow" tells someone what to do next; "member
 * role lacks workflow.edit" makes them file a support ticket.
 */
const PERMISSION_MESSAGES: Record<Capability, string> = {
  "workflow.edit": "Only an admin can change this workspace's workflow.",
  "workflow.force": "Only an admin can move a card past its workflow.",
  "sop.template.edit": "Only an admin can edit SOP templates.",
  "sop.run.start": "You don't have permission to start an SOP run.",
  "approval.decide": "Only an admin can approve or reject content.",
  "field.edit": "Only an admin can change custom fields.",
  "member.invite": "Only an admin can invite members.",
  "client.manage": "Only an admin can manage clients.",
  "asset.upload": "You don't have permission to upload files to this workspace.",
  "asset.delete": "Only an admin can archive workspace files.",
  "gate.declare": "Only an admin can declare the brand standard.",
  "gate.confirm": "Only an admin can confirm a scan before any fetch runs.",
  "gate.approve": "Only an admin can approve a campaign direction.",
  "gate.publish": "Only an admin can approve a campaign to ship.",
  "platina.task.edit": "You don't have permission to work on solution tasks.",
};
