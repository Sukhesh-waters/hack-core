/**
 * Copy audit against the declared standard (Slice 8). Deterministic first,
 * always: the claims screen runs before any model call, and a deterministic
 * failure stays a failure. The model pass then explains drift — exact
 * mismatches, each traceable to a line of the approved standard. A router
 * failure yields drift "not_run" with the claims verdict intact.
 */
import { routeAI } from "@/lib/ai/router";
import { enforceClaims, type ClaimViolation, type ClaimsDna } from "./claims";

export type DriftMismatch = {
  standardLine: string;
  copyExcerpt: string;
  why: string;
};

export type CopyAudit = {
  claims: { verdict: "passed" | "flagged"; violations: ClaimViolation[] };
  drift:
    | { state: "not_run"; mismatches: [] }
    | { state: "clean"; mismatches: [] }
    | { state: "drifted"; mismatches: DriftMismatch[] };
};

export async function auditCopyAgainstStandard(input: {
  copy: string;
  standardChunks: string[];
  dna: ClaimsDna;
}): Promise<CopyAudit> {
  const claims = enforceClaims(input.copy, input.dna);
  const claimsResult = {
    verdict: claims.verdict,
    violations: claims.violations,
  } as const;

  if (input.standardChunks.length === 0) {
    return { claims: claimsResult, drift: { state: "not_run", mismatches: [] } };
  }

  try {
    const standard = input.standardChunks
      .map((c, i) => `[${i}] ${c.slice(0, 600)}`)
      .join("\n");
    const raw = await routeAI({
      kind: "chat",
      json: true,
      system:
        "You compare marketing copy against the declared brand standard. " +
        "List only exact, traceable mismatches: each must cite the standard " +
        'line index and the offending copy excerpt. Reply JSON {"mismatches": ' +
        '[{"standardIndex": number, "copyExcerpt": string, "why": string}]}. ' +
        "If the copy conforms, reply {\"mismatches\": []}.",
      prompt: `Standard:\n${standard}\n\nCopy:\n${input.copy.slice(0, 3000)}`,
    });
    const parsed = JSON.parse(raw) as { mismatches?: unknown };
    const mismatches: DriftMismatch[] = Array.isArray(parsed.mismatches)
      ? parsed.mismatches.flatMap((m): DriftMismatch[] => {
          const mm = m as Record<string, unknown>;
          const index = Number(mm.standardIndex);
          const standardLine = input.standardChunks[index];
          if (!standardLine || typeof mm.copyExcerpt !== "string") return [];
          return [
            {
              standardLine: standardLine.slice(0, 200),
              copyExcerpt: mm.copyExcerpt.slice(0, 200),
              why: String(mm.why ?? "").slice(0, 300),
            },
          ];
        })
      : [];
    return {
      claims: claimsResult,
      drift:
        mismatches.length === 0
          ? { state: "clean", mismatches: [] }
          : { state: "drifted", mismatches },
    };
  } catch {
    return { claims: claimsResult, drift: { state: "not_run", mismatches: [] } };
  }
}
