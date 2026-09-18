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

export default async function DashboardPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const total = PIPELINE_STATUSES.reduce((sum, status) => sum + grouped[status].length, 0);

  if (total === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Nenhum item no pipeline ainda</h1>
        <p className="mt-2 text-sm text-muted-foreground">Suba um material pelo Drive ou pelo Telegram para começar.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-6">
      {PIPELINE_STATUSES.map((status) => (
        <div key={status} className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
          <p className="mt-1 text-2xl font-semibold">{grouped[status].length}</p>
        </div>
      ))}
    </div>
  );
}
