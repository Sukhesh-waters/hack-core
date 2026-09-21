import { describe, expect, it } from "vitest";
import { extractJson, firstJsonBlock } from "./json";

describe("extractJson", () => {
  it("parses a clean object", () => {
    expect(extractJson('{"ok":true}')).toEqual({ ok: true });
  });

  it("digs the object out of a reasoning model's thinking", () => {
    // The live nvidia/nemotron-3-super-120b-a12b failure, 2026-09-21.
    const raw =
      'Okay, the user is asking me to return only JSON. Here it is: {"ok":true, "why":"because"} Hope that helps!';
    expect(extractJson(raw)).toEqual({ ok: true, why: "because" });
  });

  it("handles a ```json fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("handles a bare ``` fence", () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("is not fooled by a brace inside a string", () => {
    expect(extractJson('prose {"text":"a } here","n":2} trailing')).toEqual({
      text: "a } here",
      n: 2,
    });
  });

  it("survives escaped quotes", () => {
    expect(extractJson('{"text":"she said \\"hi\\"","n":1}')).toEqual({
      text: 'she said "hi"',
      n: 1,
    });
  });

  it("handles a nested object", () => {
    expect(extractJson('think {"a":{"b":[1,2]},"c":3} done')).toEqual({
      a: { b: [1, 2] },
      c: 3,
    });
  });

  it("handles a top-level array", () => {
    expect(extractJson('here: [{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("returns null for prose with no JSON at all", () => {
    expect(extractJson("I cannot help with that.")).toBeNull();
  });

  it("returns null for malformed JSON rather than repairing it", () => {
    // Repairing would invent content. A broken reply stays broken.
    expect(extractJson('{"a":1,,}')).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
  });

  it("returns null for a bare string or number", () => {
    expect(extractJson('"just a string"')).toBeNull();
    expect(extractJson("42")).toBeNull();
  });

  it("returns null for an unterminated object", () => {
    expect(firstJsonBlock('{"a":1')).toBeNull();
  });

  it("is stable on empty input", () => {
    expect(extractJson("")).toBeNull();
    expect(firstJsonBlock("")).toBeNull();
  });
});
