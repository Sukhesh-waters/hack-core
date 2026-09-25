import { redirect } from "next/navigation";

export default async function ClientBrandRedirectPage(
  props: {
    params: Promise<{ ws: string; clientId: string }>;
  }
) {
  const params = await props.params;
  redirect(`/w/${params.ws}/brand-gene?client=${params.clientId}`);
}
