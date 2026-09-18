import { getPipelineItemsGroupedByStatus } from "@/lib/ingestion/pipeline-items";
import { formatUtcAsSaoPaulo } from "@/lib/time/timezone";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const published = grouped.publicado;

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Calendário editorial</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Horários convertidos de UTC (retorno do Zernio) para America/Sao_Paulo.
      </p>
      <div className="space-y-2">
        {published.length === 0 && <p className="text-sm text-muted-foreground">Nenhum post publicado ainda.</p>}
        {published.map((item) => (
          <div key={item.id} className="rounded-md border p-3 text-sm">
            <p className="font-medium">{item.caption_headline ?? item.title ?? "(sem título)"}</p>
            <p className="text-xs text-muted-foreground">
              {item.published_at ? formatUtcAsSaoPaulo(item.published_at) : "sem data"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
