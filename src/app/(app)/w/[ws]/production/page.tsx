import { listClients } from "@/db/queries/clients";
import {
  listContentByState,
  loadContentWorkflow,
} from "@/db/queries/workflow";
import { GlassCard } from "@/components/glass-card";
import type { StateOptionView } from "@/components/workflow-state-menu";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/lib/colors";
import {
  isOverWipLimit,
  orderedStates,
  transitionOptions,
} from "@/lib/workflow/engine";
import { NewCardForm } from "./new-card-form";
import { ProductionCard } from "./production-card";
import { ProductionLive } from "./production-live";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Production" };
export const dynamic = "force-dynamic";


export default async function ProductionPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const [rows, clients, workflow] = await Promise.all([
    listContentByState(params.ws),
    listClients(params.ws),
    loadContentWorkflow(params.ws),
  ]);

  const states = orderedStates(workflow);

  // Legality is decided here, server-side, once per state — not per card and
  // never on the client. The board only renders what the engine decided.
  const optionsByState = new Map<string, StateOptionView[]>(
    states.map((state) => [
      state.id,
      transitionOptions(workflow, state.id).map((option) => ({
        stateId: option.state.id,
        name: option.state.name,
        colorKey: option.state.colorKey,
        label: option.label,
        allowed: option.allowed,
        reason: option.reason,
      })),
    ]),
  );

  // Grouped by the state the engine actually writes. Matching
  // production_stage against legacy_stage looks equivalent and isn't: a card
  // in a custom state still carries whatever enum value it last had, so a
  // legacy-keyed board files it under the wrong column the moment anyone
  // customises. Caught exactly that way in the browser.
  const cardsByState = new Map(
    states.map((state) => [state.id, [] as typeof rows]),
  );
  for (const row of rows) {
    if (row.stateId) cardsByState.get(row.stateId)?.push(row);
  }

  const flow = states.map((s) => s.name.toLowerCase()).join(" → ");

  return (
    <PageShell width="full">
      <div className="flex items-center gap-3">
        <p className="label-mono text-brand-teal">Production</p>
        <ProductionLive workspaceId={params.ws} />
      </div>
      <h1 className="mt-2 font-display text-4xl">{flow}</h1>

      <p className="mt-2 text-sm text-muted-foreground/70">
        {workflow.name} — this workspace&apos;s own workflow. Rename a state or
        add one and this board follows.
      </p>

      <NewCardForm
        workspaceId={params.ws}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      />

      {/* Horizontally scrolling flex board — each column is a fixed width
          so 6+ states scroll instead of squeezing into unreadable slivers.
          Replaces the old CSS Grid with style={} (constitution violation). */}
      <div className="mt-8 flex gap-4 overflow-x-auto pb-4">
        {states.map((state) => {
          const cards = cardsByState.get(state.id) ?? [];
          const overLimit = isOverWipLimit(state, cards.length);
          return (
            <div key={state.id} className="w-80 shrink-0">
              {/* V2 fix: name and count stack vertically instead of
                  justify-between side-by-side, so long state names like
                  "CLIENT SIGN-OFF" never collide with the count. */}
              <div
                className={cn(
                  "border-t-2 pt-2",
                  overLimit ? "border-t-destructive/60" : "border-t-border",
                )}
              >
                <p className="label-mono text-muted-foreground/70">{state.name}</p>
                <span
                  className={cn(
                    "font-mono text-xs",
                    overLimit ? "text-destructive" : "text-muted-foreground/70",
                  )}
                  title={
                    state.wipLimit !== null
                      ? `WIP limit ${state.wipLimit}`
                      : undefined
                  }
                >
                  {state.wipLimit !== null
                    ? `${cards.length}/${state.wipLimit}`
                    : cards.length}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {cards.length === 0 ? (
                  <GlassCard className="p-4 text-center text-xs text-muted-foreground/50">
                    Empty
                  </GlassCard>
                ) : (
                  cards.map((card) => (
                    <ProductionCard
                      key={card.id}
                      workspaceId={params.ws}
                      card={{
                        id: card.id,
                        clientId: card.clientId,
                        clientName: card.clientName,
                        title: card.title,
                        type: card.type as ContentType,
                        stateId: state.id,
                        stateName: state.name,
                        stateColorKey: state.colorKey,
                        revisionCount: card.revisionCount,
                        assigneeName: card.assigneeName,
                      }}
                      options={optionsByState.get(state.id) ?? []}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
