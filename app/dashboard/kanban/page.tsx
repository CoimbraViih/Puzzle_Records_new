import { getPipelineItemsGroupedByStatus, PIPELINE_STATUSES } from "@/lib/ingestion/pipeline-items";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  recebido: "Recebido",
  legenda: "Legenda",
  renderizando: "Renderizando",
  aguardando_aprovacao: "Aguardando aprovação",
  agendado: "Agendado",
  publicado: "Publicado",
};

const ORIGIN_LABELS: Record<string, string> = {
  drive: "Drive",
  telegram: "Telegram",
  n8n: "n8n",
};

export default async function KanbanPage() {
  const grouped = await getPipelineItemsGroupedByStatus();

  return (
    <div className="flex gap-4 overflow-x-auto p-4">
      {PIPELINE_STATUSES.map((status) => (
        <div key={status} className="w-72 shrink-0 rounded-lg border bg-muted/30 p-3">
          <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
            {STATUS_LABELS[status]}
            <span className="text-muted-foreground">{grouped[status].length}</span>
          </h2>
          <div className="space-y-2">
            {grouped[status].length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum item.</p>
            )}
            {grouped[status].map((item) => (
              <div key={item.id} className="rounded-md border bg-background p-2 text-sm">
                <p className="font-medium">{item.caption_headline ?? item.title ?? "(sem título)"}</p>
                <p className="text-xs text-muted-foreground">
                  {ORIGIN_LABELS[item.origin] ?? item.origin} · {item.author ?? "autor desconhecido"}
                </p>
                {item.render_url && (
                  <a href={item.render_url} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-blue-600 underline">
                    ver vídeo renderizado
                  </a>
                )}
                {item.publish_permalink && (
                  <a href={item.publish_permalink} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-green-600 underline">
                    ver post publicado
                  </a>
                )}
                {(item.caption_error || item.render_error || item.publish_error) && (
                  <p className="mt-1 text-xs text-red-600">
                    erro: {item.caption_error ?? item.render_error ?? item.publish_error}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
