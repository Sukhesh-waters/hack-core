import { routeAI } from "@/lib/ai/router";
import { nextRoundAllowed, resolve, type Attack, type Claim } from "./contradiction";

export async function runContradictionRound(rawSignal: string) {
  if (nextRoundAllowed()) {
    throw new Error("unreachable: a second contradiction round is forbidden");
  }

  const proposerRaw = await routeAI({
    kind: "chat",
    pin: "groq",
    json: true,
    system:
      "You propose a single market driver from public signal. Reply JSON {text, evidenceSpans:string[], specificity:number 0-1}.",
    prompt: rawSignal.slice(0, 4000),
  });
  const challengerRaw = await routeAI({
    kind: "chat",
    pin: "gemini",
    json: true,
    system:
      "Attack the claim. Propose confounders. Reply JSON {text, confounders:string[], strongestObjection, confounderStrength:number 0-1}.",
    prompt: `Signal:\n${rawSignal.slice(0, 2000)}\n\nClaim:\n${proposerRaw}`,
  });

  const claim = parseClaim(proposerRaw);
  const attack = parseAttack(challengerRaw);
  const result = resolve(claim, attack);
  return { claim, attack, result };
}

function parseClaim(raw: string): Claim {
  try {
    const parsed = JSON.parse(raw) as Claim;
    return {
      text: String(parsed.text ?? raw),
      evidenceSpans: Array.isArray(parsed.evidenceSpans) ? parsed.evidenceSpans : [],
      specificity: Number(parsed.specificity ?? 0.5),
    };
  } catch {
    return { text: raw.slice(0, 400), evidenceSpans: [], specificity: 0.5 };
  }
}

function parseAttack(raw: string): Attack {
  try {
    const parsed = JSON.parse(raw) as Attack;
    return {
      text: String(parsed.text ?? raw),
      confounders: Array.isArray(parsed.confounders) ? parsed.confounders : [],
      strongestObjection: String(parsed.strongestObjection ?? ""),
      confounderStrength: Number(parsed.confounderStrength ?? 0.5),
    };
  } catch {
    return {
      text: raw.slice(0, 400),
      confounders: [],
      strongestObjection: raw.slice(0, 160),
      confounderStrength: 0.5,
    };
  }
}
