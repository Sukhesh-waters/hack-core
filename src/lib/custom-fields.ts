import { z } from "zod";

/**
 * F1 — the custom-field type registry.
 *
 * One registry, used by three places that must never disagree: the admin UI
 * that offers field types, the server action that validates a submitted
 * value, and the renderer that decides which input to draw. Splitting those
 * is how a dropdown ends up able to store a value outside its own options.
 *
 * Values are stored as jsonb per row rather than in an EAV table. At
 * small-agency scale EAV buys queryability nobody needs and costs a join on
 * every read; revisit only when someone needs to filter by a custom field
 * across thousands of rows.
 */

export const CUSTOM_FIELD_TYPES = [
  "short_text",
  "paragraph",
  "date",
  "number",
  "timestamp",
  "labels",
  "dropdown",
  "checkbox",
  "people",
  "url",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export function isCustomFieldType(value: string): value is CustomFieldType {
  return (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

/** Which objects a field can be attached to. Mirrors activitySubject so a
 *  field and its history speak about the same kinds of thing. */
export const CUSTOM_FIELD_SUBJECTS = [
  "content",
  "idea",
  "ticket",
  "campaign",
  "client",
] as const;
export type CustomFieldSubject = (typeof CUSTOM_FIELD_SUBJECTS)[number];

export type CustomFieldTypeMeta = {
  type: CustomFieldType;
  label: string;
  /** Shown in the palette, matching the reference's field descriptions. */
  hint: string;
  /** Types whose meaning depends on a configured option list. */
  needsOptions: boolean;
};

export const CUSTOM_FIELD_TYPE_META: Record<
  CustomFieldType,
  CustomFieldTypeMeta
> = {
  short_text: {
    type: "short_text",
    label: "Short text",
    hint: "A single line — names, references, short notes.",
    needsOptions: false,
  },
  paragraph: {
    type: "paragraph",
    label: "Paragraph",
    hint: "Multiple lines of free text.",
    needsOptions: false,
  },
  date: {
    type: "date",
    label: "Date",
    hint: "A calendar day, no time of day.",
    needsOptions: false,
  },
  number: {
    type: "number",
    label: "Number",
    hint: "A numeric value.",
    needsOptions: false,
  },
  timestamp: {
    type: "timestamp",
    label: "Time stamp",
    hint: "A date and a time.",
    needsOptions: false,
  },
  labels: {
    type: "labels",
    label: "Labels",
    hint: "Several free-form tags.",
    needsOptions: false,
  },
  dropdown: {
    type: "dropdown",
    label: "Dropdown",
    hint: "One choice from a list you define.",
    needsOptions: true,
  },
  checkbox: {
    type: "checkbox",
    label: "Checkbox",
    hint: "Yes or no.",
    needsOptions: false,
  },
  people: {
    type: "people",
    label: "People",
    hint: "One workspace member.",
    needsOptions: false,
  },
  url: {
    type: "url",
    label: "URL",
    hint: "A link.",
    needsOptions: false,
  },
};

/** A field as configured by a workspace admin. */
export type CustomFieldDefinition = {
  id: string;
  name: string;
  description: string | null;
  type: CustomFieldType;
  /** Only meaningful when the type needsOptions. */
  options: string[] | null;
  required: boolean;
};

const MAX_SHORT_TEXT = 255;
const MAX_PARAGRAPH = 5000;
const MAX_LABELS = 20;
const MAX_LABEL_LEN = 40;

/**
 * The validator for one field's submitted value.
 *
 * Built from the definition rather than the type alone, because a dropdown's
 * legal values ARE its configured options — validating "is a string" would
 * let any value through and make the option list decorative.
 *
 * `people` is deliberately validated only as a non-empty id here; whether
 * that id is a member of THIS workspace is a database question the caller
 * must answer, and pretending to settle it here would be a false guarantee.
 */
export function valueSchemaFor(definition: CustomFieldDefinition): z.ZodTypeAny {
  const base = ((): z.ZodTypeAny => {
    switch (definition.type) {
      case "short_text":
        return z.string().trim().max(MAX_SHORT_TEXT);
      case "paragraph":
        return z.string().trim().max(MAX_PARAGRAPH);
      case "date":
      case "timestamp":
        return z.coerce.date();
      case "number":
        return z.coerce.number().finite();
      case "labels":
        return z
          .array(z.string().trim().min(1).max(MAX_LABEL_LEN))
          .max(MAX_LABELS);
      case "dropdown": {
        const options = definition.options ?? [];
        if (options.length === 0) {
          // A dropdown with no options can hold nothing. Failing closed is
          // right: the alternative accepts arbitrary strings into a field
          // whose whole purpose is constraining them.
          return z.never();
        }
        return z.enum(options as [string, ...string[]]);
      }
      case "checkbox":
        return z.boolean();
      case "people":
        return z.string().min(1);
      case "url":
        return z
          .string()
          .trim()
          .url()
          .refine(
            (u) => u.startsWith("http://") || u.startsWith("https://"),
            "Links must start with http:// or https://",
          );
    }
  })();

  // Optional fields accept null as "cleared". Required ones do not — that is
  // the entire difference between the two.
  return definition.required ? base : base.nullable().optional();
}

export type CustomFieldValues = Record<string, unknown>;

export type ValidationResult =
  | { ok: true; values: CustomFieldValues }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates a whole submitted set against the definitions in play.
 *
 * Unknown keys are dropped rather than rejected: a field deleted while
 * someone had the form open should not make their save fail, and silently
 * persisting a value with no definition would strand data nothing can read.
 */
export function validateCustomFieldValues(
  definitions: CustomFieldDefinition[],
  submitted: CustomFieldValues,
): ValidationResult {
  const values: CustomFieldValues = {};
  const errors: Record<string, string> = {};

  for (const definition of definitions) {
    const raw = submitted[definition.id];

    if (raw === undefined || raw === null || raw === "") {
      if (definition.required) {
        errors[definition.id] = `${definition.name} is required`;
        continue;
      }
      values[definition.id] = null;
      continue;
    }

    const parsed = valueSchemaFor(definition).safeParse(raw);
    if (!parsed.success) {
      errors[definition.id] =
        parsed.error.issues[0]?.message ?? `${definition.name} is invalid`;
      continue;
    }
    // Dates round-trip through jsonb as ISO strings; storing a Date would
    // come back as a string anyway, so normalise here rather than lying
    // about the stored shape.
    values[definition.id] =
      parsed.data instanceof Date ? parsed.data.toISOString() : parsed.data;
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values };
}

/** Guards a definition at creation time. */
export const customFieldDefinitionSchema = z
  .object({
    name: z.string().trim().min(1, "Give the field a name").max(80),
    description: z.string().trim().max(200).nullable().optional(),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    required: z.boolean().default(false),
    subjects: z.array(z.enum(CUSTOM_FIELD_SUBJECTS)).min(1, "Pick at least one"),
  })
  .refine(
    (v) => !CUSTOM_FIELD_TYPE_META[v.type].needsOptions || (v.options?.length ?? 0) > 0,
    { message: "This field type needs at least one option", path: ["options"] },
  )
  .refine(
    (v) =>
      !v.options ||
      new Set(v.options.map((o) => o.toLowerCase())).size === v.options.length,
    { message: "Options must be unique", path: ["options"] },
  );
