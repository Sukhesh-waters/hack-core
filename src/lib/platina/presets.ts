/**
 * Conference source presets (Slice 7). Well-known public conference pages as
 * `conference`-kind audit sources. A preset is a convenience prefill — the
 * operator still approves the scope through the same gate, and the
 * probe/fetch path is identical to a manual URL.
 */

export type ConferencePreset = {
  key: string;
  name: string;
  url: string;
};

export const CONFERENCE_PRESETS: ConferencePreset[] = [
  {
    key: "asms",
    name: "ASMS annual conference",
    url: "https://www.asms.org/conferences/annual-conference/annual-conference-homepage",
  },
  {
    key: "pittcon",
    name: "Pittcon conference and exposition",
    url: "https://pittcon.org/",
  },
  {
    key: "hplc",
    name: "HPLC symposium series",
    url: "https://hplc-conference.org/",
  },
  {
    key: "analytica",
    name: "analytica trade fair",
    url: "https://analytica.de/en/",
  },
  {
    key: "acs",
    name: "ACS meetings and expositions",
    url: "https://www.acs.org/meetings.html",
  },
];

export function getConferencePreset(key: string): ConferencePreset | null {
  return CONFERENCE_PRESETS.find((p) => p.key === key) ?? null;
}
