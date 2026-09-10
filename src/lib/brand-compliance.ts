import type { BrandContext } from "@/db/schema";

export type ComplianceViolation = {
  type: "banned_word" | "avoid_topic" | "tone_mismatch";
  message: string;
  matchedText: string;
};

export function evaluateBrandCompliance(
  text: string,
  declared?: BrandContext | null,
): { score: number; violations: ComplianceViolation[] } {
  if (!declared || !text) {
    return { score: 100, violations: [] };
  }

  const violations: ComplianceViolation[] = [];
  const lower = text.toLowerCase();

  // 1. Check Banned Words
  for (const banned of declared.bannedWords || []) {
    if (!banned.trim()) continue;
    const regex = new RegExp(`\\b${banned.trim().toLowerCase()}\\b`, "i");
    if (regex.test(lower)) {
      violations.push({
        type: "banned_word",
        message: `Contains banned word: "${banned}"`,
        matchedText: banned,
      });
    }
  }

  // 2. Check Avoid Topics
  for (const topic of declared.avoidTopics || []) {
    if (!topic.trim()) continue;
    const regex = new RegExp(`\\b${topic.trim().toLowerCase()}\\b`, "i");
    if (regex.test(lower)) {
      violations.push({
        type: "avoid_topic",
        message: `Mentions avoided topic: "${topic}"`,
        matchedText: topic,
      });
    }
  }

  // Compute Score (100 base)
  let score = 100;
  for (const v of violations) {
    if (v.type === "banned_word") score -= 30;
    if (v.type === "avoid_topic") score -= 20;
  }

  score = Math.max(0, Math.min(100, score));

  return { score, violations };
}
