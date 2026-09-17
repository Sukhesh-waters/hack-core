import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/router", () => ({
  routeAI: vi.fn(),
}));

import { routeAI } from "@/lib/ai/router";
import { auditCopyAgainstStandard } from "./drift";
import { DEFAULT_CLAIMS_DNA } from "./claims-gate";

const standard = ["We never promise guaranteed results."];

afterEach(() => {
  vi.mocked(routeAI).mockReset();
});

describe("auditCopyAgainstStandard", () => {
  it("deterministic claims run first and stand regardless of the model", async () => {
    vi.mocked(routeAI).mockResolvedValue('{"mismatches": []}' as never);
    const audit = await auditCopyAgainstStandard({
      copy: "Our results are guaranteed.",
      standardChunks: standard,
      dna: DEFAULT_CLAIMS_DNA,
    });
    expect(audit.claims.verdict).toBe("flagged");
    expect(audit.claims.violations[0].rule).toBe("banned_term");
    expect(audit.drift.state).toBe("clean");
  });

  it("drift mismatches cite the standard line and the copy excerpt", async () => {
    vi.mocked(routeAI).mockResolvedValue(
      JSON.stringify({
        mismatches: [
          {
            standardIndex: 0,
            copyExcerpt: "we promise outcomes",
            why: "promises outcomes the standard forbids",
          },
        ],
      }) as never,
    );
    const audit = await auditCopyAgainstStandard({
      copy: "we promise outcomes",
      standardChunks: standard,
      dna: DEFAULT_CLAIMS_DNA,
    });
    expect(audit.drift.state).toBe("drifted");
    if (audit.drift.state === "drifted") {
      expect(audit.drift.mismatches[0].standardLine).toContain("never promise");
      expect(audit.drift.mismatches[0].copyExcerpt).toBe("we promise outcomes");
    }
  });

  it("a router failure yields not_run with the claims verdict intact", async () => {
    vi.mocked(routeAI).mockRejectedValue(new Error("router down"));
    const audit = await auditCopyAgainstStandard({
      copy: "guaranteed accuracy",
      standardChunks: standard,
      dna: DEFAULT_CLAIMS_DNA,
    });
    expect(audit.drift.state).toBe("not_run");
    expect(audit.claims.verdict).toBe("flagged");
  });

  it("no standard on record means drift does not run", async () => {
    const audit = await auditCopyAgainstStandard({
      copy: "anything",
      standardChunks: [],
      dna: DEFAULT_CLAIMS_DNA,
    });
    expect(audit.drift.state).toBe("not_run");
    expect(routeAI).not.toHaveBeenCalled();
  });

  it("a mismatch with an out-of-range standard index is dropped, not fabricated", async () => {
    vi.mocked(routeAI).mockResolvedValue(
      JSON.stringify({
        mismatches: [
          { standardIndex: 99, copyExcerpt: "x", why: "invented reference" },
        ],
      }) as never,
    );
    const audit = await auditCopyAgainstStandard({
      copy: "x",
      standardChunks: standard,
      dna: DEFAULT_CLAIMS_DNA,
    });
    expect(audit.drift.state).toBe("clean");
  });
});
