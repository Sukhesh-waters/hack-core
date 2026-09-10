"use client";

import { Button } from "@/components/ui/button";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Repeatable brand-color rows: native color picker + hex text, removable. */
export function ColorPaletteInput({
  value,
  onChange,
  max = 8,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const set = (index: number, color: string) =>
    onChange(value.map((v, i) => (i === index ? color : v)));

  return (
    <div>
      <p className="label-mono text-muted-foreground/70">Brand palette</p>
      <div className="mt-2 space-y-2">
        {value.map((color, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`Color ${index + 1} picker`}
              value={HEX.test(color) ? color : "#000000"}
              onChange={(e) => set(index, e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            <input
              value={color}
              aria-label={`Color ${index + 1} hex`}
              onChange={(e) => set(index, e.target.value)}
              placeholder="#0d9488"
              className="w-28 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      {value.length < max ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => onChange([...value, "#0d9488"])}
        >
          Add color
        </Button>
      ) : null}
    </div>
  );
}
