// lib/publishing/publish-post.ts
import { createClient } from "@supabase/supabase-js";
import { getZernioClient } from "./zernio-client";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface PublishJobData {
  pipelineItemId: string;
}

export async function processPublishJob({ pipelineItemId }: PublishJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, render_url, caption_headline, caption_body")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || !item.render_url || item.status === "publicado") return;

  try {
    const client = getZernioClient();
    const result = await client.publish({
      instagramAccountId: process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID ?? "",
      videoUrl: item.render_url,
      captionText: `${item.caption_headline}\n\n${item.caption_body}`,
    });

    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "publicado",
        published_at: result.publishedAtUtc,
        publish_post_id: result.postId,
        publish_permalink: result.permalink,
        publish_error: null,
      })
      .eq("id", pipelineItemId);
    if (updateError) throw updateError;

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "renderizando", to: "publicado", postId: result.postId },
    });
  } catch (err) {
    console.error(`[publish] falha ao publicar ${pipelineItemId}:`, err);
    const { error: errorUpdateError } = await supabase
      .from("pipeline_items")
      .update({ publish_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
    if (errorUpdateError) {
      console.error(`[publish] falha ao registrar publish_error para ${pipelineItemId}:`, errorUpdateError);
    }
  }
}
