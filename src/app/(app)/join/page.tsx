import { GlassCard } from "@/components/glass-card";
import { JoinWorkspaceForm } from "./join-form";

export const metadata = { title: "Join a workspace" };

export default function JoinWorkspacePage() {
  return (
    <div className="mx-auto max-w-lg">
      <p className="label-mono text-brand-purple">Join</p>
      <h1 className="mt-2 font-display text-4xl">Join a workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Paste the invite code your workspace owner shared with you.
      </p>
      <GlassCard className="mt-8 p-7">
        <JoinWorkspaceForm />
      </GlassCard>
    </div>
  );
}
