import { describe, expect, it } from "vitest";
import {
  CHUNK_OVERLAP_CHARS,
  chunkText,
  extractReadableText,
  MAX_CHUNK_CHARS,
} from "./knowledge-ingest";

describe("extractReadableText", () => {
  it("strips script/style/nav/header/footer, keeps body text", () => {
    const html = `
      <html>
        <head><title> Aurora Skincare — About </title></head>
        <body>
          <nav>Home About</nav>
          <header>Header banner</header>
          <script>trackEvent();</script>
          <style>.x{color:red}</style>
          <main>We make clean skincare for sensitive skin.</main>
          <footer>Copyright 2026</footer>
        </body>
      </html>`;
    const { title, text } = extractReadableText(html);
    expect(title).toBe("Aurora Skincare — About");
    expect(text).toContain("We make clean skincare for sensitive skin.");
    expect(text).not.toContain("trackEvent");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Home About");
    expect(text).not.toContain("Copyright 2026");
  });

  it("collapses whitespace and returns null title when absent", () => {
    const { title, text } = extractReadableText(
      "<body>  hello   \n\n  world  </body>",
    );
    expect(title).toBeNull();
    expect(text).toBe("hello world");
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("A short paragraph about a skincare brand.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("A short paragraph about a skincare brand.");
  });

  it("splits multiple paragraphs exceeding the window into several chunks", () => {
    const paragraph = "Sentence about the brand. ".repeat(60); // ~1600 chars
    const text = [paragraph, paragraph, paragraph].join("\n\n");
    const chunks = chunkText(text, { maxChars: 1200, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200 + 100);
    }
  });

  it("hard-splits a single paragraph longer than maxChars", () => {
    const oneLongParagraph = "x".repeat(3_000);
    const chunks = chunkText(oneLongParagraph, {
      maxChars: 1000,
      overlapChars: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("carries the previous chunk's overlap tail into the next chunk", () => {
    // Each paragraph is well under maxChars on its own, so accumulation
    // (not hard-splitting) is what triggers the overlap-prepend path.
    const paragraphs = Array.from(
      { length: 12 },
      (_, i) =>
        `Paragraph ${i} about the brand and its story and mission it holds dear.`.repeat(
          2,
        ),
    );
    const chunks = chunkText(paragraphs.join("\n\n"), {
      maxChars: MAX_CHUNK_CHARS,
      overlapChars: CHUNK_OVERLAP_CHARS,
    });
    expect(chunks.length).toBeGreaterThan(1);
    const tailOfFirst = chunks[0].slice(-CHUNK_OVERLAP_CHARS);
    expect(chunks[1].startsWith(tailOfFirst.slice(0, 20))).toBe(true);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n   ")).toEqual([]);
  });
});
