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
      analytics: item.publish_post_id
        ? await client.getAnalytics(item.publish_post_id).catch(() => null)
        : null,
    })),
  );

  return (
    <div className="p-6">
      <h1 className="mb-4 font-display text-xl font-bold">Analytics</h1>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Post</th>
              <th className="px-3 py-2 font-medium">Alcance</th>
              <th className="px-3 py-2 font-medium">Engajamento</th>
              <th className="px-3 py-2 font-medium">Impressões</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, analytics }) => (
              <tr key={item.id} className="border-t border-border">
                <td className="px-3 py-2">{item.caption_headline ?? item.title ?? "(sem título)"}</td>
                <td className="px-3 py-2 font-mono text-series-1">{analytics?.reach ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{analytics?.engagement ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{analytics?.impressions ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
