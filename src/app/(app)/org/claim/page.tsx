import { GlassCard } from "@/components/glass-card";
import { ClaimOrgForm } from "./claim-form";

export const metadata = { title: "Claim your org" };

export default function OrgClaimPage() {
  return (
    <div className="mx-auto max-w-lg">
      <p className="label-mono text-brand-teal">Step 1 of 2</p>
      <h1 className="mt-2 font-display text-4xl">Claim your organization</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Your org is the billing and ownership boundary. Client workspaces live
        inside it.
      </p>
      <GlassCard className="mt-8 p-7">
        <ClaimOrgForm />
      </GlassCard>
    </div>
  );
}
