import { createClient } from "@supabase/supabase-js";

export type PipelineItemOrigin = "drive" | "telegram";

export interface BuildPipelineItemInput {
  origin: PipelineItemOrigin;
  externalId: string;
  title: string | null;
  author: string | null;
  mimeType: string | null;
  driveFileId?: string;
  storagePath?: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineItemPayload {
  origin: PipelineItemOrigin;
  external_id: string;
  status: "recebido";
  title: string | null;
  author: string | null;
  mime_type: string | null;
  drive_file_id: string | null;
  storage_path: string | null;
  metadata: Record<string, unknown>;
}

export function buildPipelineItemPayload(input: BuildPipelineItemInput): PipelineItemPayload {
  return {
    origin: input.origin,
    external_id: input.externalId,
    status: "recebido",
    title: input.title,
    author: input.author,
    mime_type: input.mimeType,
    drive_file_id: input.driveFileId ?? null,
    storage_path: input.storagePath ?? null,
    metadata: input.metadata ?? {},
  };
}

function getServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Idempotente: se (origin, external_id) já existe, não faz nada e retorna null.
 * Cobre o caso de webhook + polling processarem o mesmo arquivo.
 */
export async function upsertPipelineItem(input: BuildPipelineItemInput) {
  const supabase = getServiceRoleClient();
  const payload = buildPipelineItemPayload(input);

  const { data, error } = await supabase
    .from("pipeline_items")
    .upsert(payload, { onConflict: "origin,external_id", ignoreDuplicates: true })
    .select("id, external_id")
    .maybeSingle();

  if (error) throw error;
  return data; // null quando já existia (ignoreDuplicates não retorna a linha existente)
}
