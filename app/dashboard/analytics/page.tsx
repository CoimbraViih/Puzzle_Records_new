import { getPipelineItemsGroupedByStatus } from "@/lib/ingestion/pipeline-items";
import { getZernioClient } from "@/lib/publishing/zernio-client";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const published = grouped.publicado;
  const client = getZernioClient();

  const rows = await Promise.all(
    published.map(async (item) => ({
      item,
      analytics: item.publish_post_id ? await client.getAnalytics(item.publish_post_id) : null,
    })),
  );

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Analytics</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2">Post</th>
            <th className="pb-2">Alcance</th>
            <th className="pb-2">Engajamento</th>
            <th className="pb-2">Impressões</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, analytics }) => (
            <tr key={item.id} className="border-t">
              <td className="py-2">{item.caption_headline ?? item.title ?? "(sem título)"}</td>
              <td className="py-2">{analytics?.reach ?? "—"}</td>
              <td className="py-2">{analytics?.engagement ?? "—"}</td>
              <td className="py-2">{analytics?.impressions ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
