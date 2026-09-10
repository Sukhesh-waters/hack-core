import { z } from "zod";

/**
 * Plain (non "use server") module — zod schemas that need unit tests can't
 * live in a server-action file (same "use server" export restriction noted
 * in src/lib/ticket-schemas.ts).
 *
 * Slug generation itself reuses slugify() from src/lib/validation.ts (the
 * same function workspace/org creation already uses) rather than a new
 * implementation — see that file for the lowercase/hyphenate/trim rules.
 */

// V2 (SOP layer): a doc is either a general doc or an authored SOP —
// see workspace_docs.kind in src/db/schema.ts. Defaults to "doc" so every
// pre-V2 call site (and any form that omits the field) still validates.
export const docKindSchema = z.enum(["doc", "sop", "auto"]);

export const createWorkspaceDocSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  title: z.string().trim().min(1, "Give the doc a title.").max(140),
  body: z.string().trim().max(50000).optional().default(""),
  kind: docKindSchema.optional().default("doc"),
});

export const updateWorkspaceDocSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace"),
  docId: z.string().min(1, "Missing doc"),
  title: z.string().trim().min(1, "Give the doc a title.").max(140),
  body: z.string().trim().max(50000).optional().default(""),
  kind: docKindSchema.optional().default("doc"),
});
