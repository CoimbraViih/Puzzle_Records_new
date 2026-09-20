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

export interface UpsertPipelineItemResult {
  id: string;
  status: string;
}

/**
 * Idempotente: se (origin, external_id) já existe, não recria nem sobrescreve o
 * progresso já feito (ignoreDuplicates evita voltar uma linha em "legenda"/
 * "renderizando" para "recebido"). Cobre o caso de webhook + polling
 * processarem o mesmo arquivo.
 *
 * Sempre retorna o estado atual da linha (id + status), tenha sido inserida
 * agora ou já existisse — os chamadores devem decidir se precisam enfileirar
 * o próximo job com base no `status` retornado (ex.: só enfileirar legenda se
 * `status === "recebido"`), nunca assumindo que "a linha já existia" implica
 * "já foi enfileirada". Isso é necessário porque o polling de segurança (rede
 * de proteção contra webhook perdido) frequentemente vê uma linha que já
 * existe: se o enqueue da tentativa anterior falhou (ex.: Redis fora do ar),
 * a linha ficaria presa em "recebido" para sempre se o polling só
 * reenfileirasse quando ele mesmo tivesse acabado de inserir a linha.
 */
export async function upsertPipelineItem(input: BuildPipelineItemInput): Promise<UpsertPipelineItemResult> {
  const supabase = getServiceRoleClient();
  const payload = buildPipelineItemPayload(input);

  const { error: upsertError } = await supabase
    .from("pipeline_items")
    .upsert(payload, { onConflict: "origin,external_id", ignoreDuplicates: true })
    .select("id");
  if (upsertError) throw upsertError;

  const { data, error } = await supabase
    .from("pipeline_items")
    .select("id, status")
    .eq("origin", input.origin)
    .eq("external_id", input.externalId)
    .single();
  if (error) throw error;

  return { id: data.id, status: data.status };
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
