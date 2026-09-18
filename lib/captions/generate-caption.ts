import { createClient } from "@supabase/supabase-js";
import { requestCaptionFromOpenRouter } from "./openrouter-client";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";
import { renderQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface CaptionJobData {
  pipelineItemId: string;
}

/**
 * Idempotente: só processa itens ainda em "recebido" (evita reprocessar se o
 * mesmo job for drenado duas vezes por corrida entre cron e disparo
 * imediato). Falhas ficam registradas em caption_error e o item permanece
 * "recebido" — visível e reprocessável no Kanban, sem travar a fila
 * (critério de pronto da Fase 2 no PLAN.md).
 */
export async function processCaptionJob({ pipelineItemId }: CaptionJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, title, author, origin")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || item.status !== "recebido") return;

  try {
    const caption = await requestCaptionFromOpenRouter({
      title: item.title,
      author: item.author,
      origin: item.origin,
    });

    const { data: updated, error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "legenda",
        caption_headline: caption.headline,
        caption_body: caption.body,
        caption_generated_at: new Date().toISOString(),
        caption_error: null,
      })
      .eq("id", pipelineItemId)
      // compare-and-swap: só transiciona se ainda estiver no estado esperado
      .eq("status", "recebido")
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      console.warn(
        `[caption] item ${pipelineItemId} já não estava mais em "recebido" — outro processo já avançou; abortando sem duplicar.`,
      );
      return;
    }

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "recebido", to: "legenda" },
    });

    await renderQueue.add("render", { pipelineItemId });
    triggerQueueDrain();
  } catch (err) {
    console.error(`[caption] falha ao gerar legenda para ${pipelineItemId}:`, err);
    await supabase
      .from("pipeline_items")
      .update({ caption_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
  }
}
