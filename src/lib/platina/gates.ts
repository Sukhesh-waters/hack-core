export const PLATINA_GATES = [
  "declare",
  "confirm",
  "approve",
  "publish",
] as const;

export type PlatinaGate = (typeof PLATINA_GATES)[number];

export const GATE_CAPABILITY: Record<PlatinaGate, `gate.${PlatinaGate}`> = {
  declare: "gate.declare",
  confirm: "gate.confirm",
  approve: "gate.approve",
  publish: "gate.publish",
};

export type GateWrite = {
  workspaceId: string;
  gate: PlatinaGate;
  decision: "approved" | "rejected";
  approverId: string;
  payloadHash: string;
  subjectType: string;
  subjectId: string;
  reason?: string;
};

export function assertCompleteGateEvent(event: GateWrite): void {
  if (!event.approverId) throw new Error("gate event missing approver");
  if (!event.decision) throw new Error("gate event missing decision");
  if (!event.payloadHash) throw new Error("gate event missing payload hash");
  if (!event.gate) throw new Error("gate event missing gate");
}

/** Gate existence is not configurable. Policy (who may decide) is. */
export function gateExists(gate: string): gate is PlatinaGate {
  return (PLATINA_GATES as readonly string[]).includes(gate);
}
