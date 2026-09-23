import { redirect } from "next/navigation";

export default async function WorkspaceIndex(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  redirect(`/w/${params.ws}/overview`);
}
