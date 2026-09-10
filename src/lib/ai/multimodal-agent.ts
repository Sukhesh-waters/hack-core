import type { Draft } from "./generation-agent";
import type { MergedBrandDna } from "./brand-merge";

export type StoryboardScene = {
  sceneNumber: number;
  timecode: string;
  visualDescription: string;
  onScreenText: string;
  audioGuidance: string;
};

export type ImagePromptAsset = {
  title: string;
  aspectRatio: "1:1" | "9:16" | "16:9" | "4:5";
  prompt: string;
  negativePrompt?: string;
};

export type VoiceoverLine = {
  timestamp: string;
  speaker: string;
  line: string;
  direction: string;
};

export type MultimodalAssetPack = {
  storyboard: StoryboardScene[];
  imagePrompts: ImagePromptAsset[];
  voiceover: VoiceoverLine[];
};

/**
 * Generates visual storyboard frames, image generation prompts, and audio voiceover scripts
 * tailored to the draft and brand identity.
 */
export function generateMultimodalAssets(input: {
  draft: Draft;
  brand: MergedBrandDna;
}): MultimodalAssetPack {
  const { draft, brand } = input;
  const brandColorsStr = brand.colors.length > 0 ? brand.colors.join(", ") : "emerald, indigo";
  const voiceStr = brand.tone || brand.voice || "authoritative, concise";
  const themeStr = brand.showcaseTheme || "modern minimalist";

  // 1. Storyboard Generation
  const storyboard: StoryboardScene[] = [
    {
      sceneNumber: 1,
      timecode: "00:00 - 00:03",
      visualDescription: `High-impact opening shot matching ${themeStr} aesthetic. Dynamic camera push-in establishing the core concept.`,
      onScreenText: draft.caption.slice(0, 45) + (draft.caption.length > 45 ? "…" : ""),
      audioGuidance: `Energetic and ${voiceStr} tone with subtle background riser.`,
    },
    {
      sceneNumber: 2,
      timecode: "00:03 - 00:15",
      visualDescription: `Clean product/service demonstration highlighting key benefit. Color accents in ${brandColorsStr}. Clean typography overlays.`,
      onScreenText: "Why it matters for your team",
      audioGuidance: `Steady narration pacing: "${draft.script.slice(0, 60)}…"`,
    },
    {
      sceneNumber: 3,
      timecode: "00:15 - 00:25",
      visualDescription: `Social proof or visual evidence shot. Split-screen UI or high-contrast lifestyle visual.`,
      onScreenText: "Proven results in real-time",
      audioGuidance: "Authoritative and confident delivery.",
    },
    {
      sceneNumber: 4,
      timecode: "00:25 - 00:30",
      visualDescription: `Final outro screen featuring brand logo, clear call-to-action button, and minimal background blur.`,
      onScreenText: draft.cta,
      audioGuidance: `Clear resolution tone: "${draft.cta}"`,
    },
  ];

  // 2. Image Prompts Generation (Midjourney v6 & DALL-E 3 optimized)
  const imagePrompts: ImagePromptAsset[] = [
    {
      title: "Hero Feed Cover (Square 1:1)",
      aspectRatio: "1:1",
      prompt: `Editorial photographic shot of modern workspace with subtle ${brandColorsStr} ambient lighting, minimalist design, hyper-detailed, studio lighting, Shot on Hasselblad H6D-100c --ar 1:1 --v 6.0 --style raw`,
      negativePrompt: "blurry, low quality, oversaturated, watermark, text",
    },
    {
      title: "Story / Reel Visual (Vertical 9:16)",
      aspectRatio: "9:16",
      prompt: `Cinematic vertical video keyframe showcasing innovative technology workflow, subtle glassmorphic UI overlay, glowing ${brand.colors[0] ?? "teal"} neon accents, soft bokeh --ar 9:16 --v 6.0`,
      negativePrompt: "grainy, distorted, extra limbs, bad anatomy",
    },
    {
      title: "Meta Ad Banner (Landscape 16:9)",
      aspectRatio: "16:9",
      prompt: `Premium commercial product photography for digital marketing campaign, clean negative space on left for copy, modern gradient backdrop in ${brandColorsStr} --ar 16:9 --v 6.0`,
      negativePrompt: "cluttered, noisy, dark shadows",
    },
  ];

  // 3. Voiceover & Audio Script
  const voiceover: VoiceoverLine[] = [
    {
      timestamp: "00:00",
      speaker: "Narrator (AI Voice)",
      line: draft.caption.split("\n")[0] ?? "Transform your workflow today.",
      direction: `Hook delivery, ${voiceStr}, high energy.`,
    },
    {
      timestamp: "00:05",
      speaker: "Narrator (AI Voice)",
      line: draft.script.slice(0, 120),
      direction: "Informative and natural pacing with smooth transitions.",
    },
    {
      timestamp: "00:25",
      speaker: "Narrator (AI Voice)",
      line: draft.cta,
      direction: "Decisive call to action with rising intonation.",
    },
  ];

  return { storyboard, imagePrompts, voiceover };
}
