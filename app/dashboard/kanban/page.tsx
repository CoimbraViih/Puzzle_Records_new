import { getPipelineItemsGroupedByStatus, PIPELINE_STATUSES } from "@/lib/ingestion/pipeline-items";

const STATUS_LABELS: Record<string, string> = {
  recebido: "Recebido",
  legenda: "Legenda",
  renderizando: "Renderizando",
  aguardando_aprovacao: "Aguardando aprovação",
  agendado: "Agendado",
  publicado: "Publicado",
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
                <p className="font-medium">{item.title ?? "(sem título)"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.origin === "drive" ? "Drive" : "Telegram"} · {item.author ?? "autor desconhecido"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
