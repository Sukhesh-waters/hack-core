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
    // hplc-conference.org stopped resolving (live 2026-09-21); each HPLC
    // symposium has its own yearly site. Bump the year when it is announced.
    key: "hplc",
    name: "HPLC 2027 symposium",
    url: "https://www.hplc2027.com/",
  },
  {
    key: "analytica",
    name: "analytica trade fair",
    url: "https://analytica.de/en/",
  },
  // Gulf (campaign intelligence C4). arablab.com redirects here.
  {
    key: "arablab",
    name: "ARABLAB LIVE (Dubai)",
    url: "https://www.terrapinn.com/exhibition/arablab-live/",
  },
  {
    // Formerly Medlab Middle East (medlabme.com redirects here); from 2027 a
    // Labs zone inside WHX Dubai.
    key: "whx-labs",
    name: "WHX Labs Dubai (formerly Medlab Middle East)",
    url: "https://www.worldhealthexpo.com/events/labs/dubai/",
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
