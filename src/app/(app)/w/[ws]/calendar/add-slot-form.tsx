"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCalendarPostAction, type CalendarActionState } from "./actions";

export type ClientOption = { id: string; name: string };

const selectClasses =
  "h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Adding…" : "Add to this day"}
    </Button>
  );
}

/** Direct add inside the day panel — creates a draft on this target date;
 *  it still has to clear compliance/approvals before it's a confirmed slot. */
export function AddSlotForm({
  workspaceId,
  day,
  clients,
}: {
  workspaceId: string;
  day: string;
  clients: ClientOption[];
}) {
  const [state, formAction] = useFormState<CalendarActionState, FormData>(
    addCalendarPostAction,
    undefined,
  );

  if (clients.length === 0) {
    return (
      <p className="mt-4 text-xs text-muted-foreground/70">
        Add a client first to schedule posts.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-2 border-t border-border pt-3">
      <p className="label-mono text-muted-foreground/70">Add post</p>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="day" value={day} />
      <select name="clientId" className={selectClasses} defaultValue={clients[0].id}>
        {clients.map((c) => (
          <option key={c.id} value={c.id} className="bg-neutral-900">
            {c.name}
          </option>
        ))}
      </select>
      <Input name="title" placeholder="Post title" maxLength={140} required />
      <div className="flex gap-2">
        <select name="type" className={selectClasses} defaultValue="post">
          {["post", "reel", "story", "carousel"].map((t) => (
            <option key={t} value={t} className="bg-neutral-900">
              {t}
            </option>
          ))}
        </select>
        <Input name="time" type="time" defaultValue="10:00" required className="w-28" />
      </div>
      <SubmitButton />
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
