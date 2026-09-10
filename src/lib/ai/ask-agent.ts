import { routeAI } from "@/lib/ai/router";

/**
 * Ask InstaMedia — the floating workspace assistant. Grounding is
 * first-party/operational data ONLY (clients, schedule, tasks, approvals,
 * ideas). Pattern-layer rows never enter this context, so answers can never
 * cite public data as brand evidence (two-layer rule).
 */

export type AskGrounding = {
  workspaceName: string;
  role: "owner" | "admin" | "member";
  clients: { name: string; status: string }[];
  upcomingSlots: {
    title: string;
    clientName: string;
    status: string;
    scheduledFor: Date;
  }[];
  openTasks: { text: string; priority: string }[];
  pendingApprovals: { title: string }[];
  newIdeas: { topic: string; hook: string }[];
};

/** Keep grounding token-bounded — the assistant answers about "now",
 *  not the archive. */
export const ASK_MAX_ITEMS = 10;

export function buildAskSystem(role: AskGrounding["role"]): string {
  return [
    "You are Ask InstaMedia, the in-app assistant for one agency workspace.",
    `The user's role in this workspace is "${role}".`,
    "Answer ONLY from the workspace context provided. If the context doesn't cover the question, say you don't see it in this workspace — never invent clients, posts, metrics, or dates.",
    "Never reference other workspaces or public/scraped pattern data.",
    "Be concise: a short direct answer, then at most a few supporting lines.",
  ].join(" ");
}

function section(title: string, lines: string[]): string {
  return `${title}:\n${lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "- (none)"}`;
}

export function buildAskPrompt(
  grounding: AskGrounding,
  question: string,
): string {
  const cap = <T>(rows: T[]) => rows.slice(0, ASK_MAX_ITEMS);
  return [
    `Workspace: ${grounding.workspaceName}`,
    section(
      "Clients",
      cap(grounding.clients).map((c) => `${c.name} (${c.status})`),
    ),
    section(
      "Upcoming schedule",
      cap(grounding.upcomingSlots).map(
        (s) =>
          `${s.scheduledFor.toISOString().slice(0, 10)} · ${s.clientName} · ${s.title} [${s.status}]`,
      ),
    ),
    section(
      "Open team tasks",
      cap(grounding.openTasks).map((t) => `[${t.priority}] ${t.text}`),
    ),
    section(
      "Pending approvals",
      cap(grounding.pendingApprovals).map((a) => a.title),
    ),
    section(
      "Fresh ideas awaiting review",
      cap(grounding.newIdeas).map((i) => `${i.topic} — ${i.hook}`),
    ),
    `Question: ${question}`,
  ].join("\n\n");
}

export async function askInstamedia(
  grounding: AskGrounding,
  question: string,
): Promise<string> {
  return routeAI({
    kind: "chat",
    system: buildAskSystem(grounding.role),
    prompt: buildAskPrompt(grounding, question),
  });
}
