import { PlatinaMovedNotice } from "@/components/platina/moved-notice";
import { PlatinaPage } from "@/components/platina/page";
import { enforceClaims } from "@/lib/platina/claims";

export const dynamic = "force-dynamic";

export default async function ClaimsPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ copy?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const copy = searchParams.copy ?? "";
  const result = copy
    ? enforceClaims(copy, {
        bannedTerms: ["cure", "guaranteed", "best in class"],
        regulatedClaims: ["clinically proven", "FDA approved"],
      })
    : null;

  return (
    <PlatinaPage eyebrow="claims screen" title="Claims and terminology">
      <PlatinaMovedNotice
        workspaceId={params.ws}
        to="admin/claims"
        label="Claims (Admin)"
      />
      <form className="mb-6 space-y-2">
        <textarea
          name="copy"
          defaultValue={copy}
          rows={5}
          placeholder="Paste marketing copy"
          className="w-full rounded-md border border-border bg-background p-3 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Screen
        </button>
      </form>
      {result && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">
            {result.verdict} · {result.source}
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
