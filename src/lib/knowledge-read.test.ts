/**
 * readPage (own fetch + Firecrawl, in either order), the markdown cleanup,
 * and the orphaned-"pending" display rule — the three fixes behind
 * "Fetching…" -> "Something went wrong" on the paste-a-URL ingest.
 */
import { describe, expect, it, vi } from "vitest";
import { ScrapeError } from "@/lib/scrape/firecrawl";
import {
  INGEST_ORPHAN_AFTER_MS,
  ingestDisplayStatus,
  markdownToText,
  readPage,
} from "./knowledge-ingest";

const LONG = "Real page text about the product. ".repeat(20);
const ok = (text = LONG) => vi.fn().mockResolvedValue({ title: "T", text });
const fails = (error: Error) => vi.fn().mockRejectedValue(error);

describe("readPage", () => {
  it("a person waiting gets Firecrawl first; the free fetch is not touched on success", async () => {
    const direct = ok();
    const firecrawl = ok();
    const page = await readPage("https://example.com", {
      prefer: "firecrawl",
      readers: { direct, firecrawl },
      firecrawlAvailable: true,
    });
    expect(page.via).toBe("firecrawl");
    expect(direct).not.toHaveBeenCalled();
  });

  it("a background refresh uses the free fetch first and Firecrawl only when it is blocked", async () => {
    const direct = fails(new Error("Fetch failed with status 403."));
    const firecrawl = ok();
    const page = await readPage("https://example.com", {
      prefer: "direct",
      readers: { direct, firecrawl },
      firecrawlAvailable: true,
    });
    expect(page.via).toBe("firecrawl");
    expect(direct).toHaveBeenCalledOnce();
  });

  it("a JavaScript shell (too little text) counts as a failure, not a page", async () => {
    const page = await readPage("https://example.com", {
      prefer: "direct",
      readers: { direct: ok("Loading…"), firecrawl: ok() },
      firecrawlAvailable: true,
    });
    expect(page.via).toBe("firecrawl");
  });

  it("without Firecrawl it still works exactly as before", async () => {
    const firecrawl = ok();
    const page = await readPage("https://example.com", {
      prefer: "firecrawl",
      readers: { direct: ok(), firecrawl },
      firecrawlAvailable: false,
    });
    expect(page.via).toBe("direct");
    expect(firecrawl).not.toHaveBeenCalled();
  });

  it("when both fail, the person reads both real reasons — never 'Something went wrong'", async () => {
    const error = await readPage("https://example.com", {
      prefer: "firecrawl",
      readers: {
        firecrawl: fails(new ScrapeError("Firecrawl credits are used up for this billing period (402).", true, 402)),
        direct: fails(new Error("Fetch failed with status 403.")),
      },
      firecrawlAvailable: true,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ScrapeError);
    expect(error.message).toContain("credits are used up");
    expect(error.message).toContain("blocked the request (403)");
    expect(error.message).not.toMatch(/Something went wrong/);
  });

  it("a social profile skips Firecrawl (it refuses them) and says what to use instead", async () => {
    const firecrawl = ok();
    const error = await readPage("https://www.instagram.com/acreshub/", {
      prefer: "firecrawl",
      readers: { direct: ok("Log in"), firecrawl },
      firecrawlAvailable: true,
    }).catch((e) => e);
    expect(firecrawl).not.toHaveBeenCalled();
    expect(error.message).toMatch(/social connectors/);
  });
});

describe("markdownToText", () => {
  it("keeps words and paragraphs, drops link and image syntax", () => {
    const text = markdownToText(
      "# Title\n\n![logo](https://x/y.png)\n\nRead [our report](https://x/r) now.\n\n\n\n* * *\n\nEnd",
    );
    expect(text).toBe("Title\n\nRead our report now.\n\nEnd");
  });
});

describe("ingestDisplayStatus", () => {
  const now = new Date("2026-09-21T10:00:00Z");
  it("a fresh pending row is still ingesting", () => {
    expect(ingestDisplayStatus({ status: "pending", createdAt: new Date(now.getTime() - 20_000) }, now)).toBe(
      "pending",
    );
  });
  it("a pending row older than any request could run was orphaned", () => {
    expect(
      ingestDisplayStatus(
        { status: "pending", createdAt: new Date(now.getTime() - INGEST_ORPHAN_AFTER_MS - 1) },
        now,
      ),
    ).toBe("interrupted");
  });
  it("finished rows are left alone", () => {
    const old = new Date("2020-01-01");
    expect(ingestDisplayStatus({ status: "ready", createdAt: old }, now)).toBe("ready");
    expect(ingestDisplayStatus({ status: "failed", createdAt: old }, now)).toBe("failed");
  });
});
