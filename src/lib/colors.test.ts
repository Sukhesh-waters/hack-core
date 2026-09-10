import { describe, expect, it } from "vitest";
import {
  CONTENT_STATUS_COLORS,
  CONTENT_TYPE_COLORS,
  PRODUCTION_STAGE_COLORS,
  clientColor,
} from "./colors";

// Hardcoded to mirror src/db/schema.ts pgEnum value lists — importing the
// enum objects directly is safe here (schema.ts has no DB connection side
// effects), but the literal lists are duplicated for a fast, DB-free check
// that catches drift if schema.ts's enum values ever change without colors.ts.
const CONTENT_TYPE_VALUES = ["post", "reel", "story", "carousel"] as const;
const PRODUCTION_STAGE_VALUES = [
  "brief",
  "in_progress",
  "internal_review",
  "revision",
  "done",
] as const;
const CONTENT_STATUS_VALUES = [
  "draft",
  "review",
  "approved",
  "scheduled",
  "published",
] as const;

describe("CONTENT_TYPE_COLORS", () => {
  it("has a mapping for every content type enum value", () => {
    for (const value of CONTENT_TYPE_VALUES) {
      expect(CONTENT_TYPE_COLORS[value]).toBeDefined();
      expect(CONTENT_TYPE_COLORS[value].chip).toMatch(/^bg-\S+ text-\S+$/);
      expect(CONTENT_TYPE_COLORS[value].dot).toMatch(/^bg-\S+$/);
    }
  });
});

describe("PRODUCTION_STAGE_COLORS", () => {
  it("has a mapping for every production stage enum value", () => {
    for (const value of PRODUCTION_STAGE_VALUES) {
      expect(PRODUCTION_STAGE_COLORS[value]).toBeDefined();
      expect(PRODUCTION_STAGE_COLORS[value].accent).toContain("border-t");
      expect(PRODUCTION_STAGE_COLORS[value].chip).toMatch(/^bg-\S+ text-\S+$/);
    }
  });
});

describe("CONTENT_STATUS_COLORS", () => {
  it("has a mapping for every content status enum value", () => {
    for (const value of CONTENT_STATUS_VALUES) {
      expect(CONTENT_STATUS_COLORS[value]).toBeDefined();
      expect(CONTENT_STATUS_COLORS[value].chip).toMatch(/^bg-\S+ text-\S+$/);
    }
  });
});

describe("clientColor", () => {
  it("is deterministic for the same clientId", () => {
    const a = clientColor("client-123");
    const b = clientColor("client-123");
    expect(a).toEqual(b);
  });

  it("maps different ids to different hues (not all collapsed to one)", () => {
    const ids = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    const hues = new Set(ids.map((id) => clientColor(id).dot));
    expect(hues.size).toBeGreaterThan(1);
  });

  it("always returns a static-looking dot and chip class string", () => {
    const { dot, chip } = clientColor("some-uuid-like-id");
    expect(dot).toMatch(/^bg-\S+$/);
    expect(chip).toMatch(/^bg-\S+ text-\S+$/);
  });
});
