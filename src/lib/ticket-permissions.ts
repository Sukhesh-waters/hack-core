import type { membershipRole } from "@/db/schema";

/**
 * Pure, fully-tested permission logic for a SMALL, EXPLICIT set of sensitive
 * ticket actions. `membershipRole` (owner/admin/member) exists on
 * `memberships` and, before this slice, was read nowhere for authorization —
 * every action just checked "is a member." This wires it into three actions
 * only. Deliberately NOT a general permission-scheme/config system — that's
 * Jira-Tier-3 over-engineering per jira-confluence-plan.md's feasibility
 * check. 3 roles x 3 actions is small enough to just write out as a flat
 * switch — prioritizing readability over any "matrix builder" abstraction.
 */

export type MembershipRole = (typeof membershipRole.enumValues)[number];

export type TicketAction = "delete" | "reassign_away" | "force_close";

export type TicketActionContext = {
  /** True if the acting user created the ticket OR is currently assigned
   *  to it. Only consulted for the "member" role. */
  isOwnerOfTicket: boolean;
};

/**
 * Rule set:
 * - owner:  can do anything (all three actions, always true).
 * - admin:  can reassign_away and force_close always; can NEVER delete
 *           (delete is owner-only).
 * - member: can only reassign_away or force_close on tickets where
 *           ctx.isOwnerOfTicket is true; can NEVER delete regardless of
 *           ownership.
 */
export function canPerformTicketAction(
  role: MembershipRole,
  action: TicketAction,
  ctx: TicketActionContext,
): boolean {
  switch (role) {
    case "owner":
      return true;

    case "admin":
      switch (action) {
        case "delete":
          return false;
        case "reassign_away":
        case "force_close":
          return true;
      }
      break;

    case "member":
      switch (action) {
        case "delete":
          return false;
        case "reassign_away":
        case "force_close":
          return ctx.isOwnerOfTicket;
      }
      break;
  }
  return false;
}
