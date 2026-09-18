// lib/publishing/publish-post.ts
import { getZernioClient } from "./zernio-client";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

export interface PublishJobData {
  pipelineItemId: string;
}

/**
 * Publica no Instagram — sem gate de aprovação humana (Fase 4 pulada por
 * decisão de produto), então a corretude deste processor é a única rede de
 * segurança contra publicação indevida ou duplicada.
 *
 * Duas guardas independentes:
 * 1. O item precisa estar em "renderizando" (não basta ter `render_url`
 *    preenchida): isso amarra a publicação a um render de verdade iniciado
 *    pelo pipeline, em vez de aceitar qualquer linha com uma URL gravada.
 * 2. O update final para "publicado" é condicional (`.eq("status",
 *    "renderizando")`). Se ele atualizar 0 linhas, outra invocação já
 *    publicou este item enquanto esta rodava — logamos como quase-acidente,
 *    porque nesse caso a chamada ao Zernio pode ter acontecido duas vezes.
 *    Quem evita isso na prática é o lock do drain (`lib/queue/lock.ts`); o
 *    CAS é a garantia estrutural que sobrevive à remoção do lock.
 */
export async function processPublishJob({ pipelineItemId }: PublishJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, render_url, caption_headline, caption_body")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || item.status !== "renderizando" || !item.render_url || !item.caption_headline || !item.caption_body) {
    return;
  }

  let result: Awaited<ReturnType<ReturnType<typeof getZernioClient>["publish"]>>;
  try {
    const client = getZernioClient();
    result = await client.publish({
      instagramAccountId: process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID ?? "",
      videoUrl: item.render_url,
      captionText: `${item.caption_headline}\n\n${item.caption_body}`,
      idempotencyKey: pipelineItemId,
    });
  } catch (err) {
    // Nada foi publicado ainda — seguro deixar o drainQueue re-tentar
    // (rethrow). Se já tivesse sido publicado, relançar aqui faria um retry
    // chamar client.publish() de novo e postar duas vezes no Instagram.
    console.error(`[publish] falha ao publicar ${pipelineItemId}:`, err);
    const { error: errorUpdateError } = await supabase
      .from("pipeline_items")
      .update({ publish_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
    if (errorUpdateError) {
      console.error(`[publish] falha ao registrar publish_error para ${pipelineItemId}:`, errorUpdateError);
    }
    throw err;
  }

  try {
    const { data: updated, error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "publicado",
        published_at: result.publishedAtUtc,
        publish_post_id: result.postId,
        publish_permalink: result.permalink,
        publish_error: null,
      })
      .eq("id", pipelineItemId)
      // compare-and-swap: só transiciona se ainda estiver em "renderizando"
      .eq("status", "renderizando")
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      console.warn(
        `[publish] item ${pipelineItemId} já não estava mais em "renderizando" no momento do update — ` +
          `outra invocação publicou em paralelo. POSSÍVEL PUBLICAÇÃO DUPLICADA no Zernio (post ${result.postId}) — ` +
          `verificar manualmente no Instagram.`,
      );
      return;
    }

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "renderizando", to: "publicado", postId: result.postId },
    });
  } catch (err) {
    // O post JÁ ESTÁ NO AR no Instagram (client.publish() retornou sucesso) —
    // nunca relançar aqui, ou um retry chamaria client.publish() de novo e
    // publicaria duas vezes. Só registra para intervenção manual.
    console.error(
      `[publish] item ${pipelineItemId} JÁ FOI PUBLICADO no Zernio (post ${result.postId}), mas falhou ao persistir no Supabase:`,
      err,
    );
    const { error: errorUpdateError } = await supabase
      .from("pipeline_items")
      .update({
        publish_error: `publicado no Zernio (post ${result.postId}) mas não persistido: ${err instanceof Error ? err.message : String(err)}`,
      })
      .eq("id", pipelineItemId);
    if (errorUpdateError) {
      console.error(`[publish] falha ao registrar publish_error para ${pipelineItemId}:`, errorUpdateError);
    }
  }
}
