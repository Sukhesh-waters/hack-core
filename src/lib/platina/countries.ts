/**
 * Country names <-> ISO codes, from the runtime's own region names (Intl), so
 * no hand-kept table goes stale. The LinkedIn Ad Library reports countries by
 * English name ("United Arab Emirates"); signals store ISO codes ("AE").
 */
let byName: Map<string, string> | null = null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/** Names the ad library uses that differ from Intl's English names. */
const ALIASES: Record<string, string> = {
  "united states of america": "US",
  usa: "US",
  uk: "GB",
  "korea": "KR",
  "republic of korea": "KR",
  "south korea": "KR",
  turkey: "TR",
  "czech republic": "CZ",
  "hong kong": "HK",
  "hong kong sar": "HK",
  "taiwan": "TW",
  "russia": "RU",
  "viet nam": "VN",
};

/** Old or non-country codes Intl still names ("DD" is "Germany" too). */
const NOT_A_COUNTRY = new Set(["DD", "FX", "TP", "YU", "ZR", "BU", "CS", "SU", "NT", "AN", "EU", "EZ", "UN", "QO", "ZZ"]);

function table(): Map<string, string> {
  if (byName) return byName;
  byName = new Map(Object.entries(ALIASES));
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (NOT_A_COUNTRY.has(code)) continue;
      try {
        const name = names.of(code);
        if (name && name !== code && !byName.has(norm(name))) byName.set(norm(name), code);
      } catch {
        // not a region code
      }
    }
  }
  return byName;
}

/** "United Arab Emirates" -> "AE"; an ISO code passes through; unknown -> null. */
export function countryCode(name: string): string | null {
  const trimmed = name.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return table().get(norm(trimmed)) ?? null;
}

/** "AE" -> "United Arab Emirates". */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
