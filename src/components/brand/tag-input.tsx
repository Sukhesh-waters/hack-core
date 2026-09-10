"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Free-form tag list: Enter or comma adds, click a tag to remove it. */
export function TagInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
  accent = "amber",
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  accent?: "teal" | "purple" | "amber";
}) {
  const [draft, setDraft] = useState("");
  const accentClass = {
    teal: "border-brand-teal/50 text-brand-teal",
    purple: "border-brand-purple/50 text-brand-purple",
    amber: "border-brand-amber/50 text-brand-amber",
  }[accent];

  const add = () => {
    const next = draft.trim().replace(/,+$/, "");
    if (!next) return;
    if (!value.some((v) => v.toLowerCase() === next.toLowerCase())) {
      onChange([...value, next]);
    }
    setDraft("");
  };

  return (
    <div>
      <p className="label-mono text-muted-foreground/70">{label}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p> : null}
      {value.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onChange(value.filter((v) => v !== tag))}
              title="Remove"
              className={cn(
                "rounded-full border bg-muted px-3 py-1 text-sm transition hover:opacity-70",
                accentClass,
              )}
            >
              {tag} ×
            </button>
          ))}
        </div>
      ) : null}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={placeholder ?? "Type and press Enter"}
        className="mt-2 w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
      />
    </div>
  );
}
