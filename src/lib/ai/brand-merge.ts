import type { BrandContext, BrandIdentity } from "@/db/schema";

/**
 * Superset of BrandIdentity so existing prompt builders keep working, plus the
 * declared-only visual/positioning fields generation prompts can now use.
 * Consumed by every agent; produced only by mergeBrandDna.
 */
export type MergedBrandDna = {
  voice: string;
  tone: string;
  audience: string;
  pillars: string[];
  doNots: string[];
  formats: string[];
  // declared-only passthrough (null-safe when declared is null):
  brandType: BrandContext["brandType"] | null;
  showcaseTheme: string | null;
  colors: string[];
  typography: string | null;
  // declared.bannedWords verbatim — the deterministic compliance check reads THIS
  bannedWords: string[];
};

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Merge human-declared brand context with AI-derived identity.
 * Declared always wins; identity fills gaps. Never throws — (null, null)
 * yields a neutral object, but call sites should still refuse to generate
 * when no profile row exists at all.
 */
export const NO_BRAND_CONTEXT_ERROR =
  "No brand context yet — complete intake or run research.";

/**
 * The one gate every agent call site uses: a profile row must exist AND carry
 * declared context or a researched identity. Returns null otherwise —
 * callers surface NO_BRAND_CONTEXT_ERROR.
 */
export function brandDnaFromProfile(
  profile: {
    declared: BrandContext | null;
    identity: BrandIdentity | null;
  } | null,
): MergedBrandDna | null {
  if (!profile || (!profile.declared && !profile.identity)) return null;
  return mergeBrandDna(profile.declared, profile.identity);
}

export function mergeBrandDna(
  declared: BrandContext | null,
  identity: BrandIdentity | null,
): MergedBrandDna {
  const tones = declared?.tones ?? [];
  const toneFallback = tones.length ? tones.join(", ") : "Neutral";
  return {
    voice: identity?.voice ?? toneFallback,
    tone: identity?.tone ?? toneFallback,
    audience: identity?.audience ?? "General audience",
    pillars: dedupeCaseInsensitive([
      ...(declared?.pillars ?? []),
      ...(identity?.pillars ?? []),
    ]),
    doNots: dedupeCaseInsensitive([
      ...(declared?.bannedWords ?? []),
      ...(declared?.avoidTopics ?? []),
      ...(identity?.doNots ?? []),
    ]),
    formats: identity?.formats ?? [],
    brandType: declared?.brandType ?? null,
    showcaseTheme: declared?.showcaseTheme ?? null,
    colors: declared?.colors ?? [],
    typography: declared?.typography ?? null,
    bannedWords: declared?.bannedWords ?? [],
  };
}
