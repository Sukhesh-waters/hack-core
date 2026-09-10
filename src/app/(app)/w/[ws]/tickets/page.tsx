import { listWorkspaceMembers } from "@/db/queries/memberships";
import { listTickets } from "@/db/queries/tickets";
import { listDrafts, listClients } from "@/db/queries/clients";
import { listIdeas } from "@/db/queries/ideas";
import { listCampaigns } from "@/db/queries/campaigns";
import type { TicketLinkType } from "@/lib/tickets";
import { NewTicketForm } from "./new-ticket-form";
import { TicketBoard } from "./ticket-board";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Tickets" };
export const dynamic = "force-dynamic";

// C3: suggestion links from Reports/Drift pre-fill the new-ticket form via
// query params. `linkedType` comes in as an untrusted string — validate
// against the real union before trusting it so a malformed/unexpected value
// is just treated as absent rather than ever reaching NewTicketForm as a
// value it doesn't expect. (linkedId/clientId are NOT validated for
// existence here — that's already enforced by createTicketAction's
// isolation guards at actual submit time; this pre-fill is a suggestion,
// not a trusted write path.)
const TICKET_LINK_TYPES: TicketLinkType[] = [
  "content",
  "idea",
  "campaign",
  "client",
];

function parseLinkedType(value: string | undefined): TicketLinkType | undefined {
  return value && (TICKET_LINK_TYPES as string[]).includes(value)
    ? (value as TicketLinkType)
    : undefined;
}

export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: {
    title?: string;
    description?: string;
    linkedType?: string;
    linkedId?: string;
    clientId?: string;
  };
}) {
  const [tickets, members, content, ideas, campaigns, clients] =
    await Promise.all([
      listTickets(params.ws),
      listWorkspaceMembers(params.ws),
      listDrafts(params.ws),
      listIdeas(params.ws),
      listCampaigns(params.ws),
      listClients(params.ws),
    ]);

  const initialLinkedType = parseLinkedType(searchParams.linkedType);
  // A linkedId with no valid linkedType has nothing to attach to (the
  // picker only renders once a type is selected) — drop it too rather than
  // hand the form a dangling id.
  const initialLinkedId = initialLinkedType
    ? searchParams.linkedId
    : undefined;

  return (
    <PageShell width="wide">
    <div>
      <p className="label-mono text-brand-teal">Tickets</p>
      <h1 className="mt-2 font-display text-4xl">
        Open → in progress → blocked → done
      </h1>

      <NewTicketForm
        workspaceId={params.ws}
        members={members}
        linkCandidates={{
          content: content.map((c) => ({ id: c.id, label: c.title })),
          idea: ideas.map((i) => ({ id: i.id, label: i.topic })),
          campaign: campaigns.map((c) => ({ id: c.id, label: c.name })),
          client: clients.map((c) => ({ id: c.id, label: c.name })),
        }}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initialTitle={searchParams.title}
        initialDescription={searchParams.description}
        initialLinkedType={initialLinkedType}
        initialLinkedId={initialLinkedId}
        initialClientId={searchParams.clientId}
      />

      <TicketBoard
        workspaceId={params.ws}
        tickets={tickets.map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          assigneeName: t.assigneeName,
          assigneeEmail: t.assigneeEmail,
          dueAt: t.dueAt,
        }))}
      />
    </div>
    </PageShell>
  );
}
