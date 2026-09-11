/** ~18 months of synthetic campaign/outcome history for the slow-loop demo. */

export type SyntheticMonth = {
  month: string;
  leads: number;
  qualifiedLeads: number;
  conversionRate: number;
  pipelineContribution: number;
  hypothesisWorked: boolean;
};

export function generateSyntheticHistory(
  months = 18,
  start = new Date("2025-03-01T00:00:00Z"),
): SyntheticMonth[] {
  return Array.from({ length: months }, (_, i) => {
    const date = new Date(start);
    date.setUTCMonth(date.getUTCMonth() + i);
    const leads = 40 + i * 3 + ((i * 7) % 11);
    const qualifiedLeads = Math.round(leads * (0.12 + (i % 5) * 0.02));
    const conversionRate = qualifiedLeads / leads;
    return {
      month: date.toISOString().slice(0, 7),
      leads,
      qualifiedLeads,
      conversionRate,
      pipelineContribution: qualifiedLeads * 18000,
      hypothesisWorked: conversionRate >= 0.18,
    };
  });
}

export function demotionsFromHistory(history: SyntheticMonth[], topic: string) {
  return history
    .filter((m) => !m.hypothesisWorked)
    .map((m) => ({ month: m.month, topic, worked: false }));
}
