"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/glass-card";
import { createTicketAction, type TicketState } from "./actions";
import type { TicketLinkType } from "@/lib/tickets";

export type MemberOption = { userId: string; name: string | null; email: string };

export type LinkCandidate = { id: string; label: string };

export type LinkCandidates = Record<TicketLinkType, LinkCandidate[]>;

export type ClientOption = { id: string; name: string };

const LINK_TYPES: TicketLinkType[] = ["content", "idea", "campaign", "client"];

const selectClasses =
  "h-9 rounded-md border border-border bg-transparent px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand-teal";

// C4: case-insensitive substring match for the filter <Input>s above the
// assignee and linked-candidate <select>s. Empty/whitespace query matches
// everything. Kept inline (not exported/unit-tested): it's a one-line
// predicate, and this "use client" file transitively imports the ticket
// server action (auth/DB) — importing it from a test would drag that whole
// chain into vitest's node environment for no benefit over reading the line.
function matchesFilter(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Adding…" : "New ticket"}
    </Button>
  );
}

export function NewTicketForm({
  workspaceId,
  members,
  linkCandidates,
  clients,
  initialTitle,
  initialDescription,
  initialLinkedType,
  initialLinkedId,
  initialClientId,
}: {
  workspaceId: string;
  members: MemberOption[];
  linkCandidates: LinkCandidates;
  clients: ClientOption[];
  // C3: optional pre-fill from a suggestion link (Reports underperformance,
  // Drift threshold-crossed). Purely client-side initial state — the user
  // still reviews and explicitly submits; nothing here bypasses the normal
  // createTicketAction validation/isolation path.
  initialTitle?: string;
  initialDescription?: string;
  initialLinkedType?: TicketLinkType;
  initialLinkedId?: string;
  initialClientId?: string;
}) {
  const [state, formAction] = useFormState<TicketState, FormData>(
    createTicketAction,
    undefined,
  );
  const [linkedType, setLinkedType] = useState<TicketLinkType | "">(
    initialLinkedType ?? "",
  );
  const candidates = linkedType ? linkCandidates[linkedType] : [];

  // C4: searchable assignee picker. The <select> is made controlled so a
  // filtered-out current selection can be kept selected in state rather than
  // silently cleared — a plain uncontrolled <select> resets its value the
  // moment the selected <option> is removed from the DOM, which is exactly
  // what filtering it away would otherwise do.
  const [assigneeId, setAssigneeId] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const filteredMembers = members.filter((m) =>
    matchesFilter(m.name ?? m.email, assigneeFilter),
  );
  const selectedMember = assigneeId
    ? members.find((m) => m.userId === assigneeId)
    : undefined;
  // Keep the current selection's <option> present even when the typed
  // filter would otherwise hide it, so its value survives in form state.
  const visibleMembers =
    selectedMember && !filteredMembers.some((m) => m.userId === assigneeId)
      ? [selectedMember, ...filteredMembers]
      : filteredMembers;

  // C4: same searchable-picker treatment for the linked-object candidate
  // list (content/idea/campaign/client, from F9.3).
  const [linkedId, setLinkedId] = useState(initialLinkedId ?? "");
  const [linkedFilter, setLinkedFilter] = useState("");
  const filteredCandidates = candidates.filter((c) =>
    matchesFilter(c.label, linkedFilter),
  );
  const selectedCandidate = linkedId
    ? candidates.find((c) => c.id === linkedId)
    : undefined;
  const visibleCandidates =
    selectedCandidate && !filteredCandidates.some((c) => c.id === linkedId)
      ? [selectedCandidate, ...filteredCandidates]
      : filteredCandidates;

  return (
    <GlassCard className="mt-6 space-y-2 p-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            name="title"
            placeholder="What needs doing?"
            maxLength={140}
            required
            defaultValue={initialTitle ?? ""}
            className="min-w-48 flex-1"
          />
          <select name="priority" className={selectClasses} defaultValue="medium">
            {["high", "medium", "low"].map((p) => (
              <option key={p} value={p} className="bg-neutral-900">
                {p}
              </option>
            ))}
          </select>
          <div className="flex flex-col gap-1">
            <Input
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              placeholder="Search members…"
              className="w-40"
            />
            <select
              name="assigneeId"
              className={selectClasses}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="" className="bg-neutral-900">
                Unassigned
              </option>
              {visibleMembers.map((m) => (
                <option key={m.userId} value={m.userId} className="bg-neutral-900">
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </div>
          <Input name="dueAt" type="date" className="w-40" />
          <select
            name="clientId"
            className={selectClasses}
            defaultValue={initialClientId ?? ""}
          >
            <option value="" className="bg-neutral-900">
              No client
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id} className="bg-neutral-900">
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Textarea
          name="description"
          placeholder="Details (optional)"
          maxLength={4000}
          rows={2}
          defaultValue={initialDescription ?? ""}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="linkedType"
            className={selectClasses}
            value={linkedType}
            onChange={(e) => {
              setLinkedType(e.target.value as TicketLinkType | "");
              // Candidates are a different id namespace per type — carrying
              // a stale selection/filter across a type switch would either
              // silently mismatch linkedType/linkedId or show a leftover
              // filter query that hides every candidate of the new type.
              setLinkedId("");
              setLinkedFilter("");
            }}
          >
            <option value="" className="bg-neutral-900">
              No link
            </option>
            {LINK_TYPES.map((t) => (
              <option key={t} value={t} className="bg-neutral-900">
                {t}
              </option>
            ))}
          </select>
          {linkedType ? (
            <div className="flex flex-col gap-1">
              <Input
                value={linkedFilter}
                onChange={(e) => setLinkedFilter(e.target.value)}
                placeholder="Search…"
                className="w-40"
              />
              <select
                name="linkedId"
                className={selectClasses}
                value={linkedId}
                onChange={(e) => setLinkedId(e.target.value)}
              >
                <option value="" className="bg-neutral-900">
                  {candidates.length > 0 ? "Select…" : "Nothing to link"}
                </option>
                {visibleCandidates.map((c) => (
                  <option key={c.id} value={c.id} className="bg-neutral-900">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <SubmitButton />
        </div>
        {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      </form>
    </GlassCard>
  );
}
