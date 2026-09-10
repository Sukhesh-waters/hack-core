import { redirect } from "next/navigation";

export default function AnalyticsRedirectPage({
  params,
}: {
  params: { ws: string };
}) {
  redirect(`/w/${params.ws}/reports`);
}
