"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { isUserRole, canAccessRoute, type UserRole } from "@/lib/auth/permissions";
import { upsertPipelineItem } from "@/lib/ingestion/pipeline-items";
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";
import { MAX_MEDIA_BYTES } from "./constants";

function extensionForMimeType(mimeType: string): string {
  if (mimeType.startsWith("video")) return "mp4";
  if (mimeType.startsWith("image/png")) return "png";
  return "jpg";
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
 * Cria um pipeline_item de teste a partir de um upload direto pela UI do
 * Kanban (origin: "manual"), sem precisar de Drive/Telegram/n8n
 * configurados: a equipe só sobe o vídeo/foto bruto e a IA (OpenRouter, ver
 * lib/captions/) gera manchete e legenda sozinha a partir do contexto de
 * origem — sem título/gancho fornecido pelo usuário (o prompt já trata esse
 * caso produzindo uma manchete genérica de expectativa em vez de inventar
 * fatos, ver lib/captions/prompt.ts).
 *
 * Diferente da versão anterior (que recebia uma URL https e a baixava
 * server-side), aqui o arquivo já chega no corpo do form como bytes — não há
 * fetch a uma URL fornecida pelo usuário, então o guard de SSRF usado no
 * webhook do n8n não se aplica.
 */
export async function createManualPipelineItemAction(
  _prevState: CreateManualPostState,
  formData: FormData,
): Promise<CreateManualPostState> {
  const { email } = await requireKanbanAccess();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo de vídeo ou foto para enviar.", success: false };
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return { error: "Arquivo acima do limite de 50MB (teto do plano do Supabase Storage).", success: false };
  }

  const mimeType = file.type || "application/octet-stream";
  const externalId = randomUUID();
  const storagePath = `manual/${externalId}.${extensionForMimeType(mimeType)}`;

  const fileBytes = new Uint8Array(await file.arrayBuffer());

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
      title: null,
      author: email || "teste manual",
      mimeType,
      storagePath,
      metadata: { createdVia: "kanban-manual-upload" },
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
