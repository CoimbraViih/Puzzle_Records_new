import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

const KEY_PREFIX = "pzr_";
// Tamanho do prefixo exibido na UI para o usuário reconhecer a chave numa
// lista (ex.: "pzr_AbCdEf") sem nunca guardar/exibir o valor completo de novo.
const DISPLAY_PREFIX_LENGTH = 10;

export interface GeneratedApiKey {
  plaintext: string;
  hash: string;
  prefix: string;
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}${random}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const API_KEY_COLUMNS = "id, name, key_prefix, created_at, last_used_at, revoked_at";

/**
 * Cria uma nova API key. O texto puro (`plaintext`) só existe neste retorno —
 * não é persistido em lugar nenhum, e o chamador (Server Action da UI) deve
 * exibi-lo ao usuário uma única vez, avisando que não pode ser recuperado depois.
 */
export async function createApiKey(input: { name: string; createdBy: string | null }): Promise<{
  row: ApiKeyRow;
  plaintext: string;
}> {
  const generated = generateApiKey();
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      name: input.name,
      key_hash: generated.hash,
      key_prefix: generated.prefix,
      created_by: input.createdBy,
    })
    .select(API_KEY_COLUMNS)
    .single();

  if (error) throw error;
  return { row: data as ApiKeyRow, plaintext: generated.plaintext };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select(API_KEY_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ApiKeyRow[];
}

export async function revokeApiKey(id: string): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);

  if (error) throw error;
}

/**
 * Verifica uma chave recebida em texto puro (ex.: header Authorization de um
 * webhook externo) contra o hash salvo. Fail-closed: qualquer erro de banco,
 * chave sem o prefixo esperado, inexistente ou revogada retorna null — nunca
 * lança para o chamador tratar como "autorizado" por engano.
 */
export async function verifyApiKey(plaintext: string): Promise<{ id: string; name: string } | null> {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(plaintext);
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_hash, revoked_at")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Comparação constant-time redundante com o filtro exato acima, mas mantida
  // como defesa em profundidade (mesmo padrão de app/api/creatomate/webhook).
  const stored = Buffer.from(data.key_hash);
  const provided = Buffer.from(hash);
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) return null;

  try {
    const { error: touchError } = await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    if (touchError) console.error("[api-keys] falha ao atualizar last_used_at:", touchError);
  } catch (touchError) {
    console.error("[api-keys] falha ao atualizar last_used_at:", touchError);
  }

  return { id: data.id, name: data.name };
}
