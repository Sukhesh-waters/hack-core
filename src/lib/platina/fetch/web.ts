import type { ApprovedScanSpec, RawSignalDoc, SignalAdapter } from "./registry";

/**
 * Adapter 2 (later). Own-code fetch — registered so the swap is a config
 * change, not a schema change. Not used by signal-scan today.
 */
export const webAdapter: SignalAdapter = {
  key: "web",
  async fetch(spec: ApprovedScanSpec): Promise<RawSignalDoc[]> {
    return spec.targets.map((target) => ({
      sourceUrl: target.value,
      body: "",
      adapter: "web",
      raw: { pending: true },
    }));
  },
};
