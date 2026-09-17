import { PlatinaPage } from "@/components/platina/page";
import { enforceClaims } from "@/lib/platina/claims";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina admin — claims" };

export default function AdminClaimsPage({
  searchParams,
}: {
  params: { ws: string };
  searchParams: { copy?: string };
}) {
  const copy = searchParams.copy ?? "";
  const result = copy
    ? enforceClaims(copy, {
        bannedTerms: ["cure", "guaranteed", "best in class"],
        regulatedClaims: ["clinically proven", "FDA approved"],
      })
    : null;

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Claims and terminology"
      description="Deterministic screening runs first — a deterministic failure stays a failure regardless of any model opinion. These are the default rule lists; workspace-configured rules arrive with the brand and claims pack."
    >
      <form className="mb-6 rounded-lg border border-border bg-card p-4">
        <textarea
          name="copy"
          defaultValue={copy}
          rows={5}
          placeholder="Paste marketing copy"
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        <button
          type="submit"
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Screen copy
        </button>
      </form>
      {result && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium">
            {result.verdict === "passed" ? "Passed" : "Flagged"} ·{" "}
            {result.source === "deterministic"
              ? "deterministic rules"
              : result.source}
          </p>
          <ul className="mt-2 space-y-1">
            {result.violations.map((v, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{v.rule}</span> — {v.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </PlatinaPage>
  );
}
