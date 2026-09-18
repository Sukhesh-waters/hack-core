import Link from "next/link";

/**
 * Transition-policy notice (Slice 12 step 2): the legacy route stays fully
 * functional while the owner compares it with the replacement. No redirect,
 * no deletion — those wait for the signed transition matrix.
 */
export function PlatinaMovedNotice({
  workspaceId,
  to,
  label,
}: {
  workspaceId: string;
  to: string;
  label: string;
}) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-accent/40 px-4 py-3 text-sm">
      This page has a new home:{" "}
      <Link
        href={`/p/${workspaceId}/${to}`}
        className="font-medium text-primary hover:underline"
      >
        {label}
      </Link>
      . Both stay available while the replacement is verified.
    </div>
  );
}
