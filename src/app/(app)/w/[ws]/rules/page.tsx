import { redirect } from "next/navigation";

export default function RulesPage({ params }: { params: { ws: string } }) {
  redirect(`/w/${params.ws}/kb#scraper-ops`);
}
