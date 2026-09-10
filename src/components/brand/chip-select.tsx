"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Multi-select chips over a fixed vocabulary, plus "add your own".
 * Keyboard-usable: chips are buttons; Enter in the custom field adds.
 */
export function ChipSelect({
  label,
  options,
  value,
  onChange,
  accent = "teal",
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  accent?: "teal" | "purple" | "amber";
}) {
  const [custom, setCustom] = useState("");
  const accentClass = {
    teal: "border-brand-teal/60 bg-brand-teal/10 text-brand-teal",
    purple: "border-brand-purple/60 bg-brand-purple/10 text-brand-purple",
    amber: "border-brand-amber/60 bg-brand-amber/10 text-brand-amber",
  }[accent];

  const toggle = (option: string) =>
    onChange(
      value.includes(option)
        ? value.filter((v) => v !== option)
        : [...value, option],
    );

  const addCustom = () => {
    const next = custom.trim();
    if (!next) return;
    if (!value.some((v) => v.toLowerCase() === next.toLowerCase())) {
      onChange([...value, next]);
    }
    setCustom("");
  };

  const all = [...options, ...value.filter((v) => !options.includes(v))];

  return (
    <div>
      <p className="label-mono text-muted-foreground/70">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {all.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={value.includes(option)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition",
              value.includes(option)
                ? accentClass
                : "border-border text-muted-foreground/70 hover:text-foreground",
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addCustom();
          }
        }}
        placeholder="Add your own — press Enter"
        className="mt-2 w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
      />
    </div>
  );
}
