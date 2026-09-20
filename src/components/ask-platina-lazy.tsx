"use client";

import dynamic from "next/dynamic";

// The assistant mounts on every workspace page via the layout — lazy-load
// it client-side so its bundle never blocks a route's first paint.
const AskPlatina = dynamic(
  () => import("./ask-platina").then((m) => m.AskPlatina),
  { ssr: false },
);

export function AskPlatinaLazy({ workspaceId }: { workspaceId: string }) {
  return <AskPlatina workspaceId={workspaceId} />;
}
