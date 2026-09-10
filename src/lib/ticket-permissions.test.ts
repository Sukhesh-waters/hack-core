import { describe, expect, it } from "vitest";
import {
  canPerformTicketAction,
  type MembershipRole,
  type TicketAction,
} from "./ticket-permissions";

const ACTIONS: TicketAction[] = ["delete", "reassign_away", "force_close"];

describe("canPerformTicketAction — owner", () => {
  it.each(ACTIONS)("owner can always %s", (action) => {
    expect(
      canPerformTicketAction("owner", action, { isOwnerOfTicket: false }),
    ).toBe(true);
    expect(
      canPerformTicketAction("owner", action, { isOwnerOfTicket: true }),
    ).toBe(true);
  });
});

describe("canPerformTicketAction — admin", () => {
  it("admin can never delete", () => {
    expect(
      canPerformTicketAction("admin", "delete", { isOwnerOfTicket: false }),
    ).toBe(false);
    expect(
      canPerformTicketAction("admin", "delete", { isOwnerOfTicket: true }),
    ).toBe(false);
  });

  it("admin can always reassign_away", () => {
    expect(
      canPerformTicketAction("admin", "reassign_away", {
        isOwnerOfTicket: false,
      }),
    ).toBe(true);
    expect(
      canPerformTicketAction("admin", "reassign_away", {
        isOwnerOfTicket: true,
      }),
    ).toBe(true);
  });

  it("admin can always force_close", () => {
    expect(
      canPerformTicketAction("admin", "force_close", {
        isOwnerOfTicket: false,
      }),
    ).toBe(true);
    expect(
      canPerformTicketAction("admin", "force_close", {
        isOwnerOfTicket: true,
      }),
    ).toBe(true);
  });
});

describe("canPerformTicketAction — member", () => {
  it("member can never delete, regardless of ownership", () => {
    expect(
      canPerformTicketAction("member", "delete", { isOwnerOfTicket: true }),
    ).toBe(false);
    expect(
      canPerformTicketAction("member", "delete", { isOwnerOfTicket: false }),
    ).toBe(false);
  });

  it("member can reassign_away only when they own the ticket", () => {
    expect(
      canPerformTicketAction("member", "reassign_away", {
        isOwnerOfTicket: true,
      }),
    ).toBe(true);
    expect(
      canPerformTicketAction("member", "reassign_away", {
        isOwnerOfTicket: false,
      }),
    ).toBe(false);
  });

  it("member can force_close only when they own the ticket", () => {
    expect(
      canPerformTicketAction("member", "force_close", {
        isOwnerOfTicket: true,
      }),
    ).toBe(true);
    expect(
      canPerformTicketAction("member", "force_close", {
        isOwnerOfTicket: false,
      }),
    ).toBe(false);
  });
});

/**
 * Exhaustive table-driven pass over all 9 (role x action) combinations —
 * explicit expected value per cell, using the "owning" context (favorable
 * case for member). Member's non-owning cases are covered separately above
 * since context is the one dimension that changes member's answer.
 */
describe("canPerformTicketAction — full 3x3 matrix (isOwnerOfTicket: true)", () => {
  const matrix: Record<MembershipRole, Record<TicketAction, boolean>> = {
    owner: { delete: true, reassign_away: true, force_close: true },
    admin: { delete: false, reassign_away: true, force_close: true },
    member: { delete: false, reassign_away: true, force_close: true },
  };

  for (const role of Object.keys(matrix) as MembershipRole[]) {
    for (const action of ACTIONS) {
      it(`${role} x ${action} -> ${matrix[role][action]}`, () => {
        expect(
          canPerformTicketAction(role, action, { isOwnerOfTicket: true }),
        ).toBe(matrix[role][action]);
      });
    }
  }
});

describe("canPerformTicketAction — full 3x3 matrix (isOwnerOfTicket: false)", () => {
  const matrix: Record<MembershipRole, Record<TicketAction, boolean>> = {
    owner: { delete: true, reassign_away: true, force_close: true },
    admin: { delete: false, reassign_away: true, force_close: true },
    member: { delete: false, reassign_away: false, force_close: false },
  };

  for (const role of Object.keys(matrix) as MembershipRole[]) {
    for (const action of ACTIONS) {
      it(`${role} x ${action} -> ${matrix[role][action]}`, () => {
        expect(
          canPerformTicketAction(role, action, { isOwnerOfTicket: false }),
        ).toBe(matrix[role][action]);
      });
    }
  }
});
