import { redirect } from "next/navigation";

export default function ClientBrandRedirectPage({
  params,
}: {
  params: { ws: string; clientId: string };
}) {
  redirect(`/w/${params.ws}/brand-gene?client=${params.clientId}`);
}
