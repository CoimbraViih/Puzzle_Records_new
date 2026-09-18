import { getPipelineItemsGroupedByStatus } from "@/lib/ingestion/pipeline-items";
import { formatUtcAsSaoPaulo } from "@/lib/time/timezone";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const published = grouped.publicado;

  return (
    <div className="p-6">
      <h1 className="mb-1 font-display text-xl font-bold">Calendário editorial</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Horários convertidos de UTC (retorno do Zernio) para America/Sao_Paulo.
      </p>
      <div className="space-y-2">
        {published.length === 0 && <p className="text-sm text-muted-foreground">Nenhum post publicado ainda.</p>}
        {published.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm">
            <div>
              <p className="font-medium">{item.caption_headline ?? item.title ?? "(sem título)"}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {item.published_at ? formatUtcAsSaoPaulo(item.published_at) : "sem data"}
              </p>
            </div>
            <span className="rounded-full bg-good-bg px-2 py-0.5 text-xs font-medium text-good">Publicado</span>
          </div>
        ))}
      </div>
    </div>
  );
}
