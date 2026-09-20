import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { captionQueue, renderQueue, publishQueue } from "@/workers/queues";

/**
 * Rede de segurança contra o "gap" estrutural do pipeline: toda transição de
 * etapa segue o padrão (1) grava no Supabase, (2) enfileira o próximo job.
 * Se o passo 2 falhar (ex.: Redis fora do ar, como já aconteceu neste
 * projeto — ver pendências históricas da Fase 0 no `.docs/PLAN.md`), o item
 * fica preso na etapa atual para sempre, sem nenhum erro visível no Kanban.
 *
 * Esta função roda a cada disparo do cron diário (`/api/cron/daily`) e
 * reenfileira itens "silenciosamente" presos — ou seja, sem nenhum campo de
 * erro preenchido (`caption_error`/`render_error`/`publish_error`), o que
 * indica que o job correspondente nunca chegou a rodar (se tivesse rodado e
 * falhado, o erro estaria registrado e visível para o usuário decidir se
 * quer re-tentar manualmente — não queremos brigar com esses em loop).
 *
 * Reenfileirar é seguro mesmo se o job original só estava demorando (não
 * perdido de verdade): todos os processors (`processCaptionJob`,
 * `processRenderJob`, `processPublishJob`) fazem guard de status no início e
 * compare-and-swap na transição, então uma segunda execução concorrente do
 * mesmo job é um no-op observável, nunca uma duplicação.
 */
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

export interface ReconcileResult {
  requeuedCaption: number;
  requeuedRender: number;
  requeuedPublish: number;
}

export async function reconcileStuckPipelineItems(
  thresholdMs: number = STUCK_THRESHOLD_MS,
): Promise<ReconcileResult> {
  const supabase = getServiceRoleClient();
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();

  const { data: stuckReceived, error: receivedError } = await supabase
    .from("pipeline_items")
    .select("id")
    .eq("status", "recebido")
    .is("caption_error", null)
    .lt("updated_at", cutoff);
  if (receivedError) throw receivedError;
  for (const item of stuckReceived ?? []) {
    await captionQueue.add("caption", { pipelineItemId: item.id });
  }

  const { data: stuckCaptioned, error: captionedError } = await supabase
    .from("pipeline_items")
    .select("id")
    .eq("status", "legenda")
    .is("render_error", null)
    .lt("updated_at", cutoff);
  if (captionedError) throw captionedError;
  for (const item of stuckCaptioned ?? []) {
    await renderQueue.add("render", { pipelineItemId: item.id });
  }

  const { data: stuckRendered, error: renderedError } = await supabase
    .from("pipeline_items")
    .select("id")
    .eq("status", "renderizando")
    .not("render_url", "is", null)
    .is("publish_error", null)
    .lt("updated_at", cutoff);
  if (renderedError) throw renderedError;
  for (const item of stuckRendered ?? []) {
    await publishQueue.add("publish", { pipelineItemId: item.id });
  }

  return {
    requeuedCaption: stuckReceived?.length ?? 0,
    requeuedRender: stuckCaptioned?.length ?? 0,
    requeuedPublish: stuckRendered?.length ?? 0,
  };
}
