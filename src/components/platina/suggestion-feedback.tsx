import type { SuggestionInput } from "@/db/platina-schema";

const REASONS = [
  ["not_relevant", "Not relevant"],
  ["wrong_fact", "A fact is wrong"],
  ["already_doing", "Already doing it"],
  ["bad_timing", "Bad timing"],
] as const;

/**
 * "Useful" / "Dismiss because…" on a suggestion (C8.5). Each click is a
 * decision in the ledger: it moves the suggestion's features a little, and a
 * "wrong fact" lowers the trust of the input it names. By ledger id, or by an
 * opportunity card's key.
 */
export function SuggestionFeedback({
  action,
  ws,
  back,
  suggestionId,
  subjectKey,
  inputs = [],
}: {
  /** The page passes suggestionFeedbackAction (components never import app code). */
  action: (formData: FormData) => Promise<void>;
  ws: string;
  back: string;
  suggestionId?: string;
  subjectKey?: string;
  inputs?: SuggestionInput[];
}) {
  const hidden = (
    <>
      <input type="hidden" name="workspaceId" value={ws} />
      <input type="hidden" name="back" value={back} />
      {suggestionId ? <input type="hidden" name="suggestionId" value={suggestionId} /> : null}
      {subjectKey ? <input type="hidden" name="subjectKey" value={subjectKey} /> : null}
    </>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <form action={action}>
        {hidden}
        <input type="hidden" name="decision" value="accepted" />
        <button type="submit" className="rounded-md border border-border px-2.5 py-1 hover:bg-accent">
          Useful
        </button>
      </form>
      <form action={action} className="flex flex-wrap items-center gap-1.5">
        {hidden}
        <input type="hidden" name="decision" value="dismissed" />
        <select name="reason" defaultValue="not_relevant" aria-label="Why dismiss" className="rounded-md border border-border bg-background px-1.5 py-1">
          {REASONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {inputs.length > 0 ? (
          <select name="ref" defaultValue="" aria-label="Which fact is wrong" className="max-w-[14rem] rounded-md border border-border bg-background px-1.5 py-1">
            <option value="">(if a fact is wrong: which one)</option>
            {inputs.map((i) => (
              <option key={i.ref} value={i.ref}>
                {i.label.slice(0, 70)}
              </option>
            ))}
          </select>
        ) : null}
        <button type="submit" className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:bg-accent">
          Dismiss
        </button>
      </form>
      <span className="text-muted-foreground">Teaches the learning engine.</span>
    </div>
  );
}
