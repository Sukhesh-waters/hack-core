import { redirect } from "next/navigation";

export default async function PatternsPage(props: { params: Promise<{ ws: string }> }) {
  const params = await props.params;
  redirect(`/w/${params.ws}/kb#scraper-ops`);
}
