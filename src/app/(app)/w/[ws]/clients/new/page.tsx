import { IntakeWizard } from "./wizard";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "New client" };

export default async function NewClientPage(props: { params: Promise<{ ws: string }> }) {
  const params = await props.params;
  return (
    <PageShell width="app">
      <p className="label-mono text-brand-teal">Client intake</p>
      <h1 className="mt-2 font-display text-3xl">Who are we onboarding?</h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Declare the brand context up front — voice, rules, visual identity.
        Ideation runs on this from day one; importing history is optional and
        only sharpens the baseline.
      </p>
      <div className="mt-8">
        <IntakeWizard workspaceId={params.ws} />
      </div>
    </PageShell>
  );
}
