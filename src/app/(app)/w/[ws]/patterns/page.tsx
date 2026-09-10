import { redirect } from "next/navigation";

export default function PatternsPage({ params }: { params: { ws: string } }) {
  redirect(`/w/${params.ws}/kb#scraper-ops`);
}
