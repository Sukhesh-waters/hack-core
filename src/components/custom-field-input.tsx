"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CustomFieldDefinition } from "@/lib/custom-fields";

/**
 * F4 — the presentational renderer for one user-defined field.
 *
 * Deliberately has no server-action import of its own: it takes the current
 * value and calls `onCommit` with the next one, and the caller (today the
 * calendar detail panel, later tickets) decides what "committing" means —
 * an optimistic grid update, a different action, whatever. Keeping that
 * boundary here is what lets a second surface reuse this component instead
 * of re-deriving the ten-type switch.
 */

const fieldClass =
  "w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand-teal/60 focus:bg-accent";

export type PeopleOption = { id: string; label: string };

export type CustomFieldInputProps = {
  definition: CustomFieldDefinition;
  /** The stored value for this field, keyed by definition id upstream —
   *  this component only ever sees the one value it renders. */
  value: unknown;
  onCommit: (value: unknown) => void;
  /** Only read by the "people" type. Omitting it for other types is fine. */
  peopleOptions?: PeopleOption[];
  /** Server-side validation error for this field, shown inline. */
  error?: string | null;
  disabled?: boolean;
};

/** A date-only value round-trips through jsonb as a UTC-midnight ISO
 *  string (z.coerce.date() on "YYYY-MM-DD" parses as UTC). Reading it back
 *  with UTC getters avoids a local-timezone day shift in the date input. */
function isoToDateInputValue(value: unknown): string {
  if (typeof value !== "string") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A timestamp is a real point in time, so it round-trips in local time —
 *  matching the panel's existing "Scheduled for" input. */
function isoToDatetimeLocalValue(value: unknown): string {
  if (typeof value !== "string") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function FieldError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {error}
    </p>
  );
}

function LabelsEditor({
  value,
  onCommit,
  disabled,
}: {
  value: unknown;
  onCommit: (value: unknown) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const tags = asStringArray(value);

  function addTag() {
    const next = draft.trim();
    setDraft("");
    if (!next) return;
    if (tags.includes(next)) return;
    onCommit([...tags, next]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              onClick={() => onCommit(tags.filter((t) => t !== tag))}
              className="text-muted-foreground/70 hover:text-foreground disabled:opacity-40"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        aria-label="Add a label"
        placeholder="Type and press Enter"
        className={cn(fieldClass, "mt-1.5")}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
        }}
        onBlur={addTag}
      />
    </div>
  );
}

export function CustomFieldInput({
  definition,
  value,
  onCommit,
  peopleOptions,
  error,
  disabled,
}: CustomFieldInputProps) {
  const commonTextProps = {
    "aria-label": definition.name,
    placeholder: "—",
    disabled,
    className: fieldClass,
  };

  switch (definition.type) {
    case "short_text":
      return (
        <div>
          <input
            type="text"
            {...commonTextProps}
            defaultValue={typeof value === "string" ? value : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              const normalized = next === "" ? null : next;
              if (normalized === value) return;
              onCommit(normalized);
            }}
          />
          <FieldError error={error} />
        </div>
      );

    case "paragraph":
      return (
        <div>
          <textarea
            rows={3}
            {...commonTextProps}
            className={cn(fieldClass, "min-h-20")}
            defaultValue={typeof value === "string" ? value : ""}
            onBlur={(e) => {
              const next = e.target.value.trim();
              const normalized = next === "" ? null : next;
              if (normalized === value) return;
              onCommit(normalized);
            }}
          />
          <FieldError error={error} />
        </div>
      );

    case "date":
      return (
        <div>
          <input
            type="date"
            {...commonTextProps}
            defaultValue={isoToDateInputValue(value)}
            onBlur={(e) => {
              const raw = e.target.value;
              onCommit(raw === "" ? null : raw);
            }}
          />
          <FieldError error={error} />
        </div>
      );

    case "timestamp":
      return (
        <div>
          <input
            type="datetime-local"
            {...commonTextProps}
            defaultValue={isoToDatetimeLocalValue(value)}
            onBlur={(e) => {
              const raw = e.target.value;
              const iso = raw ? new Date(raw).toISOString() : null;
              onCommit(iso);
            }}
          />
          <FieldError error={error} />
        </div>
      );

    case "number":
      return (
        <div>
          <input
            type="number"
            {...commonTextProps}
            defaultValue={typeof value === "number" ? value : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              onCommit(raw === "" ? null : Number(raw));
            }}
          />
          <FieldError error={error} />
        </div>
      );

    case "labels":
      return (
        <div>
          <LabelsEditor value={value} onCommit={onCommit} disabled={disabled} />
          <FieldError error={error} />
        </div>
      );

    case "dropdown":
      return (
        <div>
          <select
            aria-label={definition.name}
            disabled={disabled}
            className={fieldClass}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value)}
          >
            <option value="" className="bg-popover">
              —
            </option>
            {(definition.options ?? []).map((option) => (
              <option key={option} value={option} className="bg-popover">
                {option}
              </option>
            ))}
          </select>
          <FieldError error={error} />
        </div>
      );

    case "checkbox":
      return (
        <div>
          <input
            type="checkbox"
            aria-label={definition.name}
            disabled={disabled}
            className="size-4 rounded border-border bg-muted"
            checked={value === true}
            onChange={(e) => onCommit(e.target.checked)}
          />
          <FieldError error={error} />
        </div>
      );

    case "people":
      return (
        <div>
          <select
            aria-label={definition.name}
            disabled={disabled}
            className={fieldClass}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value)}
          >
            <option value="" className="bg-popover">
              Unassigned
            </option>
            {(peopleOptions ?? []).map((person) => (
              <option key={person.id} value={person.id} className="bg-popover">
                {person.label}
              </option>
            ))}
          </select>
          <FieldError error={error} />
        </div>
      );

    case "url":
      return (
        <div>
          <input
            type="url"
            {...commonTextProps}
            defaultValue={typeof value === "string" ? value : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              const normalized = next === "" ? null : next;
              if (normalized === value) return;
              onCommit(normalized);
            }}
          />
          <FieldError error={error} />
        </div>
      );
  }
}
