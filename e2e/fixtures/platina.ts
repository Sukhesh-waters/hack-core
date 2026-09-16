/**
 * Platina E2E fixtures (Slice 0, W0.6).
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

/** Every current Platina route and the h1 it renders. */
export const PLATINA_ROUTES: { subPath: string; h1: string }[] = [
  { subPath: "", h1: "Operational landing surface" },
  { subPath: "brand", h1: "Brand Gene" },
  { subPath: "scans", h1: "Scan specs" },
  { subPath: "brain", h1: "Brain" },
  { subPath: "ideation", h1: "Ideation" },
  { subPath: "campaigns", h1: "Campaigns" },
  { subPath: "claims", h1: "Claims and terminology" },
  { subPath: "receipts", h1: "Decision receipts" },
  { subPath: "config", h1: "Workspace config" },
];
