import { describe, expect, it } from "vitest";
import { membershipRole } from "@/db/schema";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  capabilitiesFor,
  isCapability,
  PermissionError,
  roleCan,
  type Capability,
  type MembershipRole,
} from "./permissions";

const ROLES = membershipRole.enumValues as readonly MembershipRole[];

describe("matrix integrity", () => {
  /** Every role must have an explicit row. A missing one would resolve to
   *  undefined and throw at the first check, in production, at the moment
   *  someone tried to do their job. */
  it("covers every role in the enum", () => {
    for (const role of ROLES) {
      expect(() => capabilitiesFor(role)).not.toThrow();
      expect(Array.isArray(capabilitiesFor(role))).toBe(true);
    }
  });

  it("grants only capabilities that exist", () => {
    for (const role of ROLES) {
      for (const capability of capabilitiesFor(role)) {
        expect(CAPABILITIES).toContain(capability);
      }
    }
  });

  it("labels and refusal messages cover every capability", () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_LABELS[capability]).toBeTruthy();
      expect(new PermissionError(capability).message).toBeTruthy();
    }
  });

  it("guards unknown capability strings", () => {
    expect(isCapability("workflow.edit")).toBe(true);
    expect(isCapability("workflow.destroy")).toBe(false);
    expect(isCapability("")).toBe(false);
  });

  /** Exhaustive: every role × capability pair resolves to a real boolean,
   *  so no combination can silently fall through to undefined. */
  it("property: every role × capability pair is decided", () => {
    for (const role of ROLES) {
      for (const capability of CAPABILITIES) {
        expect(typeof roleCan(role, capability)).toBe("boolean");
      }
    }
  });
});

describe("owner and admin", () => {
  it("hold every capability", () => {
    for (const capability of CAPABILITIES) {
      expect(roleCan("owner", capability)).toBe(true);
      expect(roleCan("admin", capability)).toBe(true);
    }
  });
});

/**
 * The interesting row, and the entire point of the matrix: a member does
 * the work but cannot rewrite the process, skip a gate, or decide their own
 * approvals.
 */
describe("member", () => {
  it("can start an SOP run — members do the work", () => {
    expect(roleCan("member", "sop.run.start")).toBe(true);
  });

  it("cannot rewrite the workflow they are subject to", () => {
    expect(roleCan("member", "workflow.edit")).toBe(false);
  });

  it("cannot force a card past its workflow", () => {
    expect(roleCan("member", "workflow.force")).toBe(false);
  });

  it("cannot decide approvals", () => {
    expect(roleCan("member", "approval.decide")).toBe(false);
  });

  it("cannot change custom fields or SOP templates", () => {
    expect(roleCan("member", "field.edit")).toBe(false);
    expect(roleCan("member", "sop.template.edit")).toBe(false);
  });

  it("holds strictly fewer capabilities than an admin", () => {
    const member = capabilitiesFor("member");
    const admin = capabilitiesFor("admin");
    expect(member.length).toBeLessThan(admin.length);
    for (const capability of member) {
      expect(admin).toContain(capability);
    }
  });
});

describe("PermissionError", () => {
  /**
   * Refusals name the action, not the role. "You need an admin to change
   * the workflow" tells someone what to do next; "member lacks
   * workflow.edit" makes them file a support ticket.
   */
  it("carries a message written for the person who hit it", () => {
    const error = new PermissionError("workflow.edit");
    expect(error.message).toMatch(/admin/i);
    expect(error.message).toMatch(/workflow/i);
    expect(error.message).not.toMatch(/workflow\.edit/);
  });

  /** actionErrorMessage keys off name to surface these verbatim rather than
   *  collapsing them into "Something went wrong". */
  it("is identifiable by name across the server-action boundary", () => {
    expect(new PermissionError("approval.decide").name).toBe(
      "PermissionError",
    );
  });

  it("keeps the capability for callers that want to branch on it", () => {
    const capability: Capability = "sop.template.edit";
    expect(new PermissionError(capability).capability).toBe(capability);
  });
});

describe("asset capabilities", () => {
  it("lets a member upload — uploading a client CSV is doing the work", () => {
    expect(roleCan("member", "asset.upload")).toBe(true);
  });

  it("does not let a member archive — archiving destroys bytes", () => {
    expect(roleCan("member", "asset.delete")).toBe(false);
  });

  it("gives owner and admin both", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(roleCan(role, "asset.upload")).toBe(true);
      expect(roleCan(role, "asset.delete")).toBe(true);
    }
  });

  it("recognises the new capability strings", () => {
    expect(isCapability("asset.upload")).toBe(true);
    expect(isCapability("asset.delete")).toBe(true);
    expect(isCapability("asset.destroy")).toBe(false);
  });
});
