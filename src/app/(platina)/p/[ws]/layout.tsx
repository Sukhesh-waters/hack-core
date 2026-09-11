import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { PlatinaSidebar } from "@/components/platina/sidebar";

export default async function PlatinaWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { ws: string };
}) {
  const user = await requireUser();
  try {
    await requireMembership(params.ws, user.id);
  } catch {
    notFound();
  }

  return (
    <div className="flex h-screen">
      <PlatinaSidebar workspaceId={params.ws} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
