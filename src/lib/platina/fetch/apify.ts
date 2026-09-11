import { fetchPublicPosts } from "@/lib/connectors/apify";
import { registerAdapter, type ApprovedScanSpec, type RawSignalDoc } from "./registry";

export async function fetchViaApify(spec: ApprovedScanSpec): Promise<RawSignalDoc[]> {
  const docs: RawSignalDoc[] = [];
  for (const target of spec.targets) {
    const handle = target.value.replace(/^https?:\/\/(www\.)?instagram.com\//, "").replace(/\/$/, "");
    try {
      const items = await fetchPublicPosts(handle, 10);
      for (const item of items) {
        docs.push({
          sourceUrl: target.value,
          title: item.externalId ?? handle,
          body: item.caption ?? "",
          adapter: "apify",
          raw: item,
        });
      }
    } catch (error) {
      docs.push({
        sourceUrl: target.value,
        title: handle,
        body: error instanceof Error ? error.message : "fetch failed",
        adapter: "apify",
        raw: { error: true },
      });
    }
  }
  return docs;
}

export function registerApifyAdapter() {
  registerAdapter({ key: "apify", fetch: fetchViaApify });
}
