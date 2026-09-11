import type { PlatinaScanTarget } from "@/db/platina-schema";

export type ApprovedScanSpec = {
  id: string;
  workspaceId: string;
  status: "approved" | "running" | "done" | "failed";
  targets: PlatinaScanTarget[];
};

export type RawSignalDoc = {
  sourceUrl: string;
  title?: string;
  body: string;
  adapter: string;
  raw?: unknown;
};

export type SignalAdapter = {
  key: string;
  fetch(spec: ApprovedScanSpec): Promise<RawSignalDoc[]>;
};

const adapters = new Map<string, SignalAdapter>();

export function registerAdapter(adapter: SignalAdapter) {
  adapters.set(adapter.key, adapter);
}

export function getAdapter(key: string): SignalAdapter | undefined {
  return adapters.get(key);
}

export function listAdapterKeys(): string[] {
  return Array.from(adapters.keys());
}

export function assertApproved(spec: ApprovedScanSpec): void {
  if (spec.status !== "approved" && spec.status !== "running") {
    throw new Error("scan spec is not approved — no fetch may run");
  }
}

export async function runApprovedScan(
  spec: ApprovedScanSpec,
  adapterKey = "apify",
): Promise<RawSignalDoc[]> {
  assertApproved(spec);
  const adapter = getAdapter(adapterKey);
  if (!adapter) {
    throw new Error(`unknown signal adapter: ${adapterKey}`);
  }
  return adapter.fetch(spec);
}
