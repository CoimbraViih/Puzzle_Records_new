import { createClient } from "@supabase/supabase-js";
import { getDriveClient } from "@/lib/ingestion/google-drive";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface PipelineItemMediaRef {
  id: string;
  origin: "drive" | "telegram";
  drive_file_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h — suficiente para o Creatomate buscar o arquivo durante o render

/**
 * Garante que o arquivo do item esteja no bucket raw-media e retorna uma URL
 * assinada, buscável pelo Creatomate. Itens do Drive ainda não têm o binário
 * baixado (a Fase 1 só registra metadados) — esta é a primeira etapa do
 * pipeline que efetivamente baixa o arquivo do Drive, e persiste o
 * storage_path de volta em pipeline_items para as próximas execuções.
 */
export async function resolveRenderableMediaUrl(item: PipelineItemMediaRef): Promise<string> {
  const supabase = getServiceRoleClient();
  let storagePath = item.storage_path;

  if (!storagePath) {
    if (item.origin !== "drive" || !item.drive_file_id) {
      throw new Error(`item ${item.id} não tem storage_path nem drive_file_id — sem mídia para renderizar`);
    }

    const drive = getDriveClient();
    const response = await drive.files.get(
      { fileId: item.drive_file_id, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const bytes = new Uint8Array(response.data as ArrayBuffer);
    const extension = (item.mime_type ?? "").startsWith("video") ? "mp4" : "jpg";
    storagePath = `drive/${item.drive_file_id}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("raw-media")
      .upload(storagePath, bytes, { contentType: item.mime_type ?? "application/octet-stream", upsert: true });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({ storage_path: storagePath })
      .eq("id", item.id);
    if (updateError) throw updateError;
  }

  const { data, error } = await supabase.storage.from("raw-media").createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw error ?? new Error("falha ao gerar signed URL");
  return data.signedUrl;
}
