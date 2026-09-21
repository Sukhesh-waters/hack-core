import { describe, expect, it } from "vitest";
import { summariseChange } from "./change-diff";

const day = (n: number) => new Date(`2026-09-${String(n).padStart(2, "0")}T10:00:00Z`);

const side = (body: string, fetchedAt = day(10), title: string | null = "Pricing") => ({
  title,
  body,
  fetchedAt,
});

const long = (text: string) => `${text} — with enough words to count as a real line.`;

describe("summariseChange", () => {
  it("reports added lines and how old the previous version was", () => {
    const out = summariseChange(
      side("We roast to order.", day(10)),
      side(`We roast to order.\n${long("New: a 48-hour roast guarantee")}`, day(17)),
    );
    expect(out).not.toBeNull();
    expect(out!.added).toHaveLength(1);
    expect(out!.removed).toHaveLength(0);
    expect(out!.summary).toContain("since 7 days ago");
    expect(out!.summary).toContain("NEW:");
    expect(out!.summary).toContain("48-hour roast guarantee");
  });

  it("reports removed lines", () => {
    const out = summariseChange(
      side(`Intro line here.\n${long("Free shipping on every order")}`, day(10)),
      side("Intro line here.", day(11)),
    );
    expect(out!.removed).toHaveLength(1);
    expect(out!.summary).toContain("GONE:");
    expect(out!.summary).toContain("since yesterday");
  });

  it("reports both sides at once", () => {
    const out = summariseChange(
      side(long("Plans start at nine pounds a month"), day(10)),
      side(long("Plans now include unlimited seats for teams"), day(12)),
    );
    expect(out!.added).toHaveLength(1);
    expect(out!.removed).toHaveLength(1);
  });

  it("says 'since earlier today' for a same-day change", () => {
    const out = summariseChange(
      side("Intro.", new Date("2026-09-10T08:00:00Z")),
      side(`Intro.\n${long("A brand new paragraph appeared")}`, new Date("2026-09-10T16:00:00Z")),
    );
    expect(out!.summary).toContain("since earlier today");
  });

  it("returns null when nothing changed", () => {
    expect(summariseChange(side("Same text."), side("Same text."))).toBeNull();
  });

  it("returns null when only whitespace changed", () => {
    expect(
      summariseChange(side("One line.\n\nTwo   line."), side("One line.\nTwo line.")),
    ).toBeNull();
  });

  it("returns null for a cosmetic numeric change (a counter, a timestamp)", () => {
    const out = summariseChange(
      side(long("Trusted by 1,024 roasters worldwide")),
      side(long("Trusted by 1,031 roasters worldwide")),
    );
    expect(out).toBeNull();
  });

  it("ignores short menu lines shuffling around", () => {
    expect(
      summariseChange(side("Home\nAbout\nShop"), side("Shop\nAbout\nHome\nNew")),
    ).toBeNull();
  });

  it("treats a changed title as a real change even when the body is stable", () => {
    const out = summariseChange(
      side("Body text stays exactly the same.", day(10), "Pricing"),
      side("Body text stays exactly the same.", day(11), "Pricing — now with a free tier"),
    );
    expect(out).not.toBeNull();
    expect(out!.summary).toContain("free tier");
    expect(out!.summary).toContain('was "Pricing"');
  });

  it("respects the character budget and says how much it cut", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      long(`Announcement number ${i} about a genuinely new product line`),
    ).join("\n");
    const out = summariseChange(side("Intro.", day(10)), side(`Intro.\n${many}`, day(11)), 300);
    expect(out!.summary.length).toBeLessThan(900);
    expect(out!.summary).toContain("more)");
    // The full list is still available to the caller, only the prose is bounded.
    expect(out!.added.length).toBe(200);
  });

  it("accepts ISO strings as well as Dates (Inngest serialises them)", () => {
    const out = summariseChange(
      { title: null, body: "Intro.", fetchedAt: "2026-09-10T10:00:00.000Z" },
      {
        title: null,
        body: `Intro.\n${long("Something genuinely new was published")}`,
        fetchedAt: "2026-09-13T10:00:00.000Z",
      },
    );
    expect(out!.summary).toContain("since 3 days ago");
  });
});
