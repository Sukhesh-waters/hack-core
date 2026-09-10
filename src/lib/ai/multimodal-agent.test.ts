import { describe, expect, it } from "vitest";
import { generateMultimodalAssets } from "./multimodal-agent";
import type { Draft } from "./generation-agent";
import type { MergedBrandDna } from "./brand-merge";

const mockDraft: Draft = {
  caption: "Supercharge your agency operations with real-time AI workflows.",
  script: "Traditional marketing workflows stall on approvals. With instant real-time sync, your team moves as one.",
  hashtags: ["#aimarketing", "#workflow", "#agencylife"],
  cta: "Try InstaMedia free today",
};

const mockBrand: MergedBrandDna = {
  voice: "Authoritative",
  tone: "Dynamic",
  audience: "Marketing Agencies & Modern Brands",
  pillars: ["realtime", "agents"],
  doNots: ["cheap", "guarantee"],
  bannedWords: ["cheap", "guarantee"],
  formats: ["reels", "static"],
  brandType: "educational_authority",
  showcaseTheme: "Modern Dark",
  colors: ["#10B981", "#8B5CF6"],
  typography: "Display Serif",
};

describe("generateMultimodalAssets", () => {
  it("produces complete storyboard, image prompts, and voiceover scripts", () => {
    const pack = generateMultimodalAssets({ draft: mockDraft, brand: mockBrand });

    expect(pack.storyboard).toHaveLength(4);
    expect(pack.imagePrompts).toHaveLength(3);
    expect(pack.voiceover).toHaveLength(3);

    // Verify storyboard scene fields
    expect(pack.storyboard[0].sceneNumber).toBe(1);
    expect(pack.storyboard[0].timecode).toBe("00:00 - 00:03");
    expect(pack.storyboard[3].onScreenText).toBe(mockDraft.cta);

    // Verify image prompts include aspect ratio flags
    expect(pack.imagePrompts[0].aspectRatio).toBe("1:1");
    expect(pack.imagePrompts[1].aspectRatio).toBe("9:16");
    expect(pack.imagePrompts[0].prompt).toContain("--ar 1:1");
  });
});
