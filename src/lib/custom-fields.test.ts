import { describe, expect, it } from "vitest";
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_META,
  customFieldDefinitionSchema,
  isCustomFieldType,
  validateCustomFieldValues,
  valueSchemaFor,
  type CustomFieldDefinition,
} from "./custom-fields";

const def = (
  over: Partial<CustomFieldDefinition> & { type: CustomFieldDefinition["type"] },
): CustomFieldDefinition => ({
  id: "f_1",
  name: "Field",
  description: null,
  options: null,
  required: false,
  ...over,
});

describe("registry integrity", () => {
  it("has metadata for every type, and no orphans", () => {
    expect(Object.keys(CUSTOM_FIELD_TYPE_META).sort()).toEqual(
      [...CUSTOM_FIELD_TYPES].sort(),
    );
  });

  it("guards unknown type strings", () => {
    expect(isCustomFieldType("short_text")).toBe(true);
    expect(isCustomFieldType("rich_text")).toBe(false);
  });
});

describe("valueSchemaFor — a dropdown's options are its legal values", () => {
  it("accepts a configured option", () => {
    const schema = valueSchemaFor(
      def({ type: "dropdown", options: ["Low", "High"], required: true }),
    );
    expect(schema.safeParse("High").success).toBe(true);
  });

  /**
   * The whole point of a dropdown is constraining values. If any string
   * passed, the option list would be decorative.
   */
  it("rejects a value outside the options", () => {
    const schema = valueSchemaFor(
      def({ type: "dropdown", options: ["Low", "High"], required: true }),
    );
    expect(schema.safeParse("Medium").success).toBe(false);
  });

  it("fails closed when a dropdown has no options", () => {
    const schema = valueSchemaFor(
      def({ type: "dropdown", options: [], required: true }),
    );
    expect(schema.safeParse("anything").success).toBe(false);
  });
});

describe("valueSchemaFor — per-type rules", () => {
  it("rejects a non-http url scheme", () => {
    const schema = valueSchemaFor(def({ type: "url", required: true }));
    expect(schema.safeParse("https://example.com").success).toBe(true);
    expect(schema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(schema.safeParse("not a url").success).toBe(false);
  });

  it("requires a real boolean for a checkbox", () => {
    const schema = valueSchemaFor(def({ type: "checkbox", required: true }));
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse("yes").success).toBe(false);
  });

  it("bounds label count and length", () => {
    const schema = valueSchemaFor(def({ type: "labels", required: true }));
    expect(schema.safeParse(["a", "b"]).success).toBe(true);
    expect(schema.safeParse(Array(25).fill("x")).success).toBe(false);
    expect(schema.safeParse(["x".repeat(50)]).success).toBe(false);
  });

  it("rejects a non-finite number", () => {
    const schema = valueSchemaFor(def({ type: "number", required: true }));
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse(Infinity).success).toBe(false);
  });

  it("lets an optional field be cleared, but not a required one", () => {
    expect(
      valueSchemaFor(def({ type: "short_text" })).safeParse(null).success,
    ).toBe(true);
    expect(
      valueSchemaFor(def({ type: "short_text", required: true })).safeParse(null)
        .success,
    ).toBe(false);
  });
});

describe("validateCustomFieldValues", () => {
  it("collects an error per offending field, not just the first", () => {
    const result = validateCustomFieldValues(
      [
        def({ id: "a", name: "Budget", type: "number", required: true }),
        def({ id: "b", name: "Link", type: "url", required: true }),
      ],
      { a: "not a number", b: "nope" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["a", "b"]);
  });

  it("names the field in a required-field error", () => {
    const result = validateCustomFieldValues(
      [def({ id: "a", name: "Budget", type: "number", required: true })],
      {},
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.a).toContain("Budget");
  });

  it("stores an absent optional field as null, not undefined", () => {
    const result = validateCustomFieldValues(
      [def({ id: "a", type: "short_text" })],
      {},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.a).toBeNull();
  });

  /**
   * A field deleted while someone had the form open must not fail their
   * save, and a value with no definition would be data nothing can read.
   */
  it("drops submitted keys that have no definition", () => {
    const result = validateCustomFieldValues(
      [def({ id: "a", type: "short_text" })],
      { a: "kept", ghost: "dropped" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toHaveProperty("a", "kept");
    expect(result.values).not.toHaveProperty("ghost");
  });

  it("normalises dates to ISO strings, matching how jsonb returns them", () => {
    const result = validateCustomFieldValues(
      [def({ id: "d", type: "date", required: true })],
      { d: "2026-08-15" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.values.d).toBe("string");
    expect(String(result.values.d)).toContain("2026-08-15");
  });
});

describe("customFieldDefinitionSchema", () => {
  const base = {
    name: "Priority",
    type: "dropdown" as const,
    subjects: ["content" as const],
  };

  it("requires options for a type that needs them", () => {
    expect(customFieldDefinitionSchema.safeParse(base).success).toBe(false);
    expect(
      customFieldDefinitionSchema.safeParse({ ...base, options: ["A"] }).success,
    ).toBe(true);
  });

  it("does not demand options for types that don't need them", () => {
    expect(
      customFieldDefinitionSchema.safeParse({
        name: "Notes",
        type: "paragraph",
        subjects: ["content"],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate options, case-insensitively", () => {
    expect(
      customFieldDefinitionSchema.safeParse({
        ...base,
        options: ["High", "high"],
      }).success,
    ).toBe(false);
  });

  it("requires at least one subject — a field attached to nothing is dead", () => {
    expect(
      customFieldDefinitionSchema.safeParse({
        ...base,
        options: ["A"],
        subjects: [],
      }).success,
    ).toBe(false);
  });
});
