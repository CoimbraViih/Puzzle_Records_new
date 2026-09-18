import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/ingestion/cron-auth";
import { resolveRenderableMediaUrl } from "./media";
import { startCreatomateRender } from "./creatomate-client";
import { buildCreatomateModifications } from "./modifications";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface RenderJobData {
  pipelineItemId: string;
}

export async function processRenderJob({ pipelineItemId }: RenderJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, origin, drive_file_id, storage_path, mime_type, caption_headline, caption_body")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || item.status !== "legenda" || !item.caption_headline || !item.caption_body) return;

  try {
    const mediaUrl = await resolveRenderableMediaUrl(item);
    const modifications = buildCreatomateModifications(
      { headline: item.caption_headline, body: item.caption_body },
      { photo1Url: mediaUrl },
    );
    const webhookUrl = `${requireEnv("PUBLIC_BASE_URL")}/api/creatomate/webhook?token=${requireEnv("CREATOMATE_WEBHOOK_SECRET")}&item=${pipelineItemId}`;
    const render = await startCreatomateRender(modifications, webhookUrl);

    const { data: updated, error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "renderizando",
        render_id: render.id,
        render_started_at: new Date().toISOString(),
        render_error: null,
      })
      .eq("id", pipelineItemId)
      // compare-and-swap: só transiciona se ainda estiver no estado esperado
      .eq("status", "legenda")
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      console.warn(
        `[render] item ${pipelineItemId} já não estava mais em "legenda" — outro processo já avançou; abortando sem duplicar.`,
      );
      return;
    }

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "legenda", to: "renderizando" },
    });
  } catch (err) {
    console.error(`[render] falha ao iniciar render para ${pipelineItemId}:`, err);
    const { error: errorUpdateError } = await supabase
      .from("pipeline_items")
      .update({ render_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
    if (errorUpdateError) {
      console.error(`[render] falha ao registrar render_error para ${pipelineItemId}:`, errorUpdateError);
    }
  }
}
