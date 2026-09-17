import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { buildActionPacket, PACKET_VERSION, type BuildPacketInput } from "./packet";

const schema = JSON.parse(
  readFileSync(join(__dirname, "packet.schema.json"), "utf-8"),
);

function validInput(): BuildPacketInput {
  return {
    workspaceId: "ws-1",
    solutionId: "sol-1",
    title: "ASMS follow-up",
    problemStatement: "Competitor launched a mid-range LC-MS for QC labs",
    findingRefs: ["finding-1"],
    affectedScope: { division: "Life Sciences", region: "North America" },
    severity: "high",
    urgency: "immediate",
    approvedEvidenceRefs: [{ id: "bc-1", kind: "brand_chunk" }],
    unvalidatedMarketSignalRefs: [{ id: "br-1", kind: "brain_chunk" }],
    syntheticOutcomeIds: [],
    strongestUncertainty: "Single-region signal",
    actionSteps: [
      {
        title: "Finalize messaging",
        owner: "user-1",
        dueDate: "2026-10-01T00:00:00.000Z",
        eventPhase: "pre",
        status: "todo",
      },
    ],
    owner: "user-1",
    reviewers: [],
    dueDate: "2026-10-15T00:00:00.000Z",
    expectedOutcome: "20 qualified leads from QC labs",
    measurementPlan: {
      method: "CRM import",
      reviewDate: "2026-12-15T00:00:00.000Z",
    },
    claimsStatus: {
      verdict: "passed",
      blockingViolations: [],
      exceptions: [],
    },
    approvals: [
      {
        step: "direction_approved",
        decision: "approved",
        approverId: "user-1",
        at: "2026-09-17T00:00:00.000Z",
        payloadHash: "abc123",
      },
    ],
    provenance: {
      signalDocumentIds: ["sig-1"],
      transcriptIds: ["tr-1"],
      brainChunkIds: ["br-1"],
      receiptId: "rec-1",
      gateEventIds: ["ge-1"],
    },
    exportedBy: "user-1",
    now: new Date("2026-09-17T12:00:00Z"),
  };
}

describe("buildActionPacket", () => {
  it("builds a packet that validates against packet.schema.json", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const packet = buildActionPacket(validInput());
    const valid = validate(packet);
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
    expect(packet.packetVersion).toBe(PACKET_VERSION);
  });

  it("keeps the two evidence buckets separate by construction", () => {
    const packet = buildActionPacket(validInput());
    expect(packet.evidence.approvedEvidenceRefs[0].kind).toBe("brand_chunk");
    expect(packet.evidence.unvalidatedMarketSignalRefs[0].kind).toBe(
      "brain_chunk",
    );
    // The kind unions are disjoint at the type level; this asserts runtime.
    const approvedKinds: Set<string> = new Set(
      packet.evidence.approvedEvidenceRefs.map((r) => r.kind),
    );
    expect(approvedKinds.has("brain_chunk")).toBe(false);
  });

  it("refuses synthetic outcome ids in approved evidence (A4)", () => {
    const input = validInput();
    input.approvedEvidenceRefs.push({ id: "out-9", kind: "outcome" });
    input.syntheticOutcomeIds = ["out-9"];
    expect(() => buildActionPacket(input)).toThrow(/synthetic/);
  });

  it("attests unvalidatedDirection when approved evidence is empty — and never shows a confidence number", () => {
    const input = validInput();
    input.approvedEvidenceRefs = [];
    const packet = buildActionPacket(input);
    expect(packet.unvalidatedDirection).toBe(true);
    expect(JSON.stringify(packet)).not.toMatch(/confidence/);
  });

  it("carries provenance by identifier only — no raw public content", () => {
    const packet = buildActionPacket(validInput());
    expect(packet.provenance.syntheticDataExcluded).toBe(true);
    expect(JSON.stringify(packet)).not.toContain("raw");
    expect(packet.provenance.signalDocumentIds).toEqual(["sig-1"]);
  });

  it("rejects invalid packets at the schema boundary (missing required)", () => {
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const packet = buildActionPacket(validInput()) as unknown as Record<
      string,
      unknown
    >;
    delete packet.severity;
    expect(validate(packet)).toBe(false);
  });
});
