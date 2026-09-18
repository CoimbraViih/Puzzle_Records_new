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

// Cor de status por etapa do pipeline (Design.md §2/§6): "processando" (roxo)
// é visualmente distinto de "aguardando ação humana" (âmbar) de propósito.
const STATUS_ACCENT: Record<string, string> = {
  recebido: "text-muted-foreground",
  legenda: "text-processing",
  renderizando: "text-processing",
  aguardando_aprovacao: "text-warning",
  agendado: "text-info",
  publicado: "text-good",
};

export default async function DashboardPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const total = PIPELINE_STATUSES.reduce((sum, status) => sum + grouped[status].length, 0);

  if (total === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="font-display text-xl font-bold">Nenhum item no pipeline ainda</h1>
        <p className="mt-2 text-sm text-muted-foreground">Suba um material pelo Drive ou pelo Telegram para começar.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 font-display text-xl font-bold">Painel</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {PIPELINE_STATUSES.map((status) => (
          <div key={status} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
            <p className={`mt-1 font-mono text-2xl font-medium ${STATUS_ACCENT[status]}`}>{grouped[status].length}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
