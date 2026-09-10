"use client";

import dynamic from "next/dynamic";

// The assistant mounts on every workspace page via the layout — lazy-load
// it client-side so its bundle never blocks a route's first paint.
const AskInstamedia = dynamic(
  () => import("./ask-instamedia").then((m) => m.AskInstamedia),
  { ssr: false },
);

export function AskInstamediaLazy({ workspaceId }: { workspaceId: string }) {
  return <AskInstamedia workspaceId={workspaceId} />;
}
