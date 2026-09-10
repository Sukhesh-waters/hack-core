import type { BrandContext } from "@/db/schema";

export const BRAND_TYPES: Array<{
  value: BrandContext["brandType"];
  title: string;
  blurb: string;
}> = [
  {
    value: "personal_brand",
    title: "Personal brand",
    blurb: "A person is the product — founder voice, face-forward.",
  },
  {
    value: "product_promotion",
    title: "Product promotion",
    blurb: "Sell a product line — launches, offers, social proof.",
  },
  {
    value: "aesthetic_lifestyle",
    title: "Aesthetic / lifestyle",
    blurb: "Mood-led feed — visual cohesion above everything.",
  },
  {
    value: "minimalistic",
    title: "Minimalistic",
    blurb: "Few words, lots of whitespace, restrained palette.",
  },
  {
    value: "educational_authority",
    title: "Educational authority",
    blurb: "Teach to earn trust — how-tos, breakdowns, myth-busting.",
  },
  {
    value: "community_ugc",
    title: "Community / UGC",
    blurb: "The audience makes the content — reposts, challenges.",
  },
];

export const TONE_OPTIONS = [
  "Warm",
  "Bold",
  "Educational",
  "Playful",
  "Minimal",
  "Authentic",
];

export const PILLAR_OPTIONS = ["Education", "Product", "UGC", "Founder voice"];
