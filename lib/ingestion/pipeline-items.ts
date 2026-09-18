import { getServiceRoleClient } from "@/lib/supabase/service-role";

export type PipelineItemOrigin = "drive" | "telegram" | "n8n";

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

export interface PipelineItemRow {
  id: string;
  origin: PipelineItemOrigin;
  status: string;
  title: string | null;
  author: string | null;
  created_at: string;
  caption_headline: string | null;
  caption_error: string | null;
  render_url: string | null;
  render_error: string | null;
  published_at: string | null;
  publish_post_id: string | null;
  publish_permalink: string | null;
  publish_error: string | null;
}

const PIPELINE_STATUSES = [
  "recebido",
  "legenda",
  "renderizando",
  "aguardando_aprovacao",
  "agendado",
  "publicado",
] as const;

/**
 * Nota: esta função usa o client de service role para simplificar a Fase 1
 * (mesma factory já usada nos webhooks). Como a página já está atrás de
 * `proxy.ts` (só usuários autenticados com papel válido chegam em
 * `/dashboard/kanban`), o controle de acesso efetivo continua garantido —
 * mas isso decide *não* depender da policy de RLS lida acima para a leitura
 * da UI. Se preferir manter a leitura passando pela RLS (client autenticado
 * do usuário, não service role), trocar por `createClient` de
 * `lib/supabase/server.ts` nesta função antes de ir para produção.
 */
export async function getPipelineItemsGroupedByStatus() {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("pipeline_items")
    .select(
      "id, origin, status, title, author, created_at, caption_headline, caption_error, render_url, render_error, published_at, publish_post_id, publish_permalink, publish_error",
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const grouped = Object.fromEntries(PIPELINE_STATUSES.map((status) => [status, [] as PipelineItemRow[]]));
  for (const item of data ?? []) {
    (grouped[item.status] ??= []).push(item as PipelineItemRow);
  }
  return grouped as Record<(typeof PIPELINE_STATUSES)[number], PipelineItemRow[]>;
}

export { PIPELINE_STATUSES };
