import { redirect } from "next/navigation";

export default function WorkspaceIndex({
  params,
}: {
  params: { ws: string };
}) {
  redirect(`/w/${params.ws}/overview`);
}
