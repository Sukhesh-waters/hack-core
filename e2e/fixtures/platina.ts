/**
 * Platina E2E fixtures.
 *
 * Reuses the existing e2e-fixture workspace: membership is product-agnostic,
 * and every Platina page renders an honest empty state with zero rows. The
 * single source of truth for the workspace id stays in ./workspace — this
 * module only re-exports it.
 */
import { NOT_FOUND_TEXT, WORKSPACE_ID } from "./workspace";

export { NOT_FOUND_TEXT, WORKSPACE_ID };

export function platinaPath(subPath: string): string {
  const trimmed = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  return `/p/${WORKSPACE_ID}/${trimmed}`;
}

/** Primary destinations (Slice 1 shell) and the h1 each renders. */
export const PLATINA_ROUTES: { subPath: string; h1: string }[] = [
  { subPath: "", h1: "What changed, what matters, what needs you" },
  { subPath: "audits", h1: "Audit sources" },
  { subPath: "findings", h1: "Findings" },
  { subPath: "solutions", h1: "Solutions" },
  { subPath: "solutions/new", h1: "New solution" },
  { subPath: "outcomes", h1: "Outcomes and decision history" },
  { subPath: "admin", h1: "Workspace administration" },
  { subPath: "admin/brand", h1: "Brand standard" },
  { subPath: "admin/claims", h1: "Claims and terminology" },
];

/**
 * Legacy routes kept reachable for owner comparison until their transition
 * slices (governing plan transition policy). Still asserted so a shell
 * change cannot silently break them.
 */
export const PLATINA_LEGACY_ROUTES: { subPath: string; h1: string }[] = [
  { subPath: "brand", h1: "Brand Gene" },
  { subPath: "scans", h1: "Scan specs" },
  { subPath: "brain", h1: "Brain" },
  { subPath: "ideation", h1: "Ideation" },
  { subPath: "campaigns", h1: "Campaigns" },
  { subPath: "claims", h1: "Claims and terminology" },
  { subPath: "receipts", h1: "Decision receipts" },
  { subPath: "config", h1: "Workspace config" },
];
