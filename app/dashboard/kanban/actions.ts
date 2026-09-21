"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { isUserRole, canAccessRoute, type UserRole } from "@/lib/auth/permissions";
import { assertPublicHttpsUrl } from "@/lib/http/url-safety";
import { upsertPipelineItem } from "@/lib/ingestion/pipeline-items";
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";

// Mesmo limite usado no webhook do n8n e no download do Drive (lib/render/media.ts).
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function extensionForMimeType(mimeType: string): string {
  if (mimeType.startsWith("video")) return "mp4";
  if (mimeType.startsWith("image/png")) return "png";
  return "jpg";
}

function guessMimeTypeFromUrl(url: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".mp4") || path.endsWith(".mov")) return "video/mp4";
  if (path.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

/**
 * Defesa em profundidade: /dashboard/kanban já é bloqueada por papel no
 * proxy.ts, mas Server Actions podem ser invocadas diretamente sem passar
 * pela navegação — repetimos a checagem aqui, fail-closed, mesmo padrão de
 * app/dashboard/configuracoes/actions.ts.
 */
async function requireKanbanAccess(): Promise<{ email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("não autenticado");

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (error) throw new Error("falha ao verificar permissão");

  const role: UserRole | undefined = isUserRole(profile?.role) ? profile.role : undefined;
  if (!role || !canAccessRoute(role, "/dashboard/kanban")) {
    throw new Error("acesso restrito");
  }

  return { email: user.email ?? "" };
}

export interface CreateManualPostState {
  error: string | null;
  success: boolean;
}

/**
 * Cria um pipeline_item de teste direto pela UI do Kanban (origin: "manual"),
 * sem precisar de Drive/Telegram/n8n configurados — para testes manuais
 * ponta a ponta do pipeline (legenda → render → publicação). Espelha o
 * mesmo fluxo de app/api/n8n/webhook/route.ts: baixa a mídia de uma URL
 * https pública (com o mesmo guard de SSRF), sobe para o bucket raw-media e
 * enfileira a geração de legenda.
 */
export async function createManualPipelineItemAction(
  _prevState: CreateManualPostState,
  formData: FormData,
): Promise<CreateManualPostState> {
  const { email } = await requireKanbanAccess();

  const title = String(formData.get("title") ?? "").trim();
  const mediaUrl = String(formData.get("mediaUrl") ?? "").trim();

  if (!title) return { error: "Dê um título/manchete para o post.", success: false };
  if (!mediaUrl) return { error: "Informe a URL pública (https) da foto/vídeo.", success: false };

  try {
    await assertPublicHttpsUrl(mediaUrl);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "mediaUrl inválida", success: false };
  }

  const mimeType = guessMimeTypeFromUrl(mediaUrl);

  let fileBytes: Uint8Array;
  try {
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      throw new Error(`download falhou com status ${mediaResponse.status}`);
    }
    const contentLength = mediaResponse.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_MEDIA_BYTES) {
      throw new Error("mídia acima do limite de 50MB");
    }
    const buffer = await mediaResponse.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      throw new Error("mídia acima do limite de 50MB");
    }
    fileBytes = new Uint8Array(buffer);
  } catch (error) {
    return {
      error: `Não foi possível baixar a mídia: ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }

  const externalId = randomUUID();
  const storagePath = `manual/${externalId}.${extensionForMimeType(mimeType)}`;

  const supabase = getServiceRoleClient();
  const { error: uploadError } = await supabase.storage
    .from("raw-media")
    .upload(storagePath, fileBytes, { contentType: mimeType, upsert: false });
  if (uploadError) {
    return { error: `Falha ao salvar mídia: ${uploadError.message}`, success: false };
  }

  try {
    const result = await upsertPipelineItem({
      origin: "manual",
      externalId,
      title,
      author: email || "teste manual",
      mimeType,
      storagePath,
      metadata: { createdVia: "kanban-manual-form" },
    });

    if (result.status === "recebido") {
      await captionQueue.add("caption", { pipelineItemId: result.id });
      triggerQueueDrain();
    }
  } catch (error) {
    return {
      error: `Falha ao registrar o item: ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }

  revalidatePath("/dashboard/kanban");
  return { error: null, success: true };
}
