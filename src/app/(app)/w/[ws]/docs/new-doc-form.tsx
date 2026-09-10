"use client";

import { DocEditor } from "./doc-editor";

/** Thin wrapper so page.tsx (a server component) can render the client
 *  DocEditor in "create" mode without itself becoming a client component. */
export function NewDocForm({ workspaceId }: { workspaceId: string }) {
  return <DocEditor mode="create" workspaceId={workspaceId} />;
}
