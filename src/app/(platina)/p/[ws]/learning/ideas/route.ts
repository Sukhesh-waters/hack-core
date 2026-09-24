import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { runIdeaEngine } from "@/lib/platina/idea-run";

export const dynamic = "force-dynamic";

/**
 * Idea engine (C8.5, ask A5): drafts ideas for one trigger, streamed as it
 * works — the trigger's facts, the Brand DNA it found, the learned patterns
 * it used, the model call, the citation check — and records every idea in
 * the suggestion ledger, so each one is traceable from the Learning page.
 */
export async function POST(request: Request, props: { params: Promise<{ ws: string }> }) {
  const { ws } = await props.params;
  const user = await requireUser();
  await requireMembership(ws, user.id);
  const body = (await request.json().catch(() => ({}))) as { key?: string };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const started = Date.now();
      try {
        const result = await runIdeaEngine(ws, body.key, (id, label, detail) =>
          send({ type: "step", id, label, detail, ms: Date.now() - started }),
        );
        send({ type: "ideas", ...result });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "the ideas could not be drafted" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
