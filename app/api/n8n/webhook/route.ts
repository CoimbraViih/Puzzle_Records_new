// app/api/n8n/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys/api-keys";
import { isHttpsUrl } from "@/lib/http/url-safety";
import { upsertPipelineItem } from "@/lib/ingestion/pipeline-items";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";

export const dynamic = "force-dynamic";

// Teto de tamanho para o download da mídia apontada por mediaUrl (mesmo
// limite usado em lib/render/media.ts para o download do Drive).
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

// externalId é escolhido pelo chamador (diferente de Drive/Telegram, que usam
// IDs gerados pelo próprio provedor) e vira um segmento do caminho de storage
// (`n8n/${externalId}.ext`) — validado para impedir path traversal (ex.: "../").
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

interface N8nWebhookPayload {
  externalId?: string;
  title?: string | null;
  author?: string | null;
  mediaUrl?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

function extractBearerToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("video")) return "mp4";
  if (mimeType.startsWith("image")) return "jpg";
  return "bin";
}

/**
 * Endpoint genérico de ingestão para o n8n (ou qualquer automação externa
 * autenticada com uma API key criada em /dashboard/configuracoes): recebe
 * uma URL de mídia https, baixa o arquivo, salva no bucket raw-media e cria
 * um pipeline_item em "recebido" — o mesmo formato de entrada usado por
 * Drive e Telegram (ver lib/ingestion/telegram.ts para o padrão espelhado).
 *
 * Autenticação por API key própria (tabela api_keys), não por secret fixo
 * via env var como os outros webhooks: aqui o objetivo é permitir múltiplas
 * automações externas, cada uma com sua própria chave revogável.
 */
export async function POST(request: NextRequest) {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "missing Authorization Bearer token" }, { status: 401 });
  }

  const apiKey = await verifyApiKey(token);
  if (!apiKey) {
    return NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as N8nWebhookPayload | null;
  if (!payload?.externalId || !payload.mediaUrl) {
    return NextResponse.json({ error: "externalId e mediaUrl são obrigatórios" }, { status: 400 });
  }

  if (!EXTERNAL_ID_PATTERN.test(payload.externalId)) {
    return NextResponse.json({ error: "externalId inválido" }, { status: 400 });
  }

  if (!isHttpsUrl(payload.mediaUrl)) {
    return NextResponse.json({ error: "mediaUrl precisa ser uma URL https" }, { status: 400 });
  }

  let fileBytes: Uint8Array;
  try {
    const mediaResponse = await fetch(payload.mediaUrl);
    if (!mediaResponse.ok) {
      throw new Error(`download da mídia falhou com status ${mediaResponse.status}`);
    }
    const contentLength = mediaResponse.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_MEDIA_BYTES) {
      throw new Error(`mídia declara ${contentLength} bytes, acima do limite de ${MAX_MEDIA_BYTES} bytes`);
    }
    const buffer = await mediaResponse.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      throw new Error(`mídia tem ${buffer.byteLength} bytes, acima do limite de ${MAX_MEDIA_BYTES} bytes`);
    }
    fileBytes = new Uint8Array(buffer);
  } catch (error) {
    console.error("[n8n/webhook] falha ao baixar mediaUrl:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "não foi possível baixar mediaUrl" }, { status: 400 });
  }

  const mimeType = payload.mimeType ?? "application/octet-stream";
  const storagePath = `n8n/${payload.externalId}.${extensionFor(mimeType)}`;

  const supabase = getServiceRoleClient();
  const { error: uploadError } = await supabase.storage
    .from("raw-media")
    .upload(storagePath, fileBytes, { contentType: mimeType, upsert: false });
  // upsert: false + 409 (already exists) é esperado em reentrega do n8n —
  // mesmo tratamento do webhook do Telegram.
  if (uploadError && uploadError.status !== 409 && uploadError.statusCode !== "409") {
    console.error("[n8n/webhook] falha ao subir mídia para o Supabase Storage:", uploadError);
    return NextResponse.json({ error: "falha ao salvar mídia" }, { status: 500 });
  }

  // A mídia já foi gravada no bucket raw-media neste ponto. Se o registro do
  // pipeline_item falhar daqui pra frente (ex.: migration 4 não aplicada —
  // constraint de `origin` rejeita 'n8n'), não deixamos a exceção escapar:
  // isso deixaria o arquivo órfão no storage e devolveria um 500 genérico
  // (sem JSON) para o n8n, que tende a reentregar o mesmo request
  // indefinidamente. Registramos externalId/storagePath para limpeza manual
  // e respondemos com um contrato de erro estável, igual aos demais ramos.
  let result: Awaited<ReturnType<typeof upsertPipelineItem>>;
  try {
    result = await upsertPipelineItem({
      origin: "n8n",
      externalId: payload.externalId,
      title: payload.title ?? null,
      author: payload.author ?? null,
      mimeType,
      storagePath,
      metadata: { ...payload.metadata, apiKeyId: apiKey.id, apiKeyName: apiKey.name },
    });

    if (result) {
      await captionQueue.add("caption", { pipelineItemId: result.id });
      triggerQueueDrain();
    }
  } catch (error) {
    console.error(
      "[n8n/webhook] falha ao registrar pipeline_item após upload para o storage:",
      { externalId: payload.externalId, storagePath },
      error,
    );
    return NextResponse.json({ error: "falha ao registrar o item" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pipelineItemId: result?.id ?? null });
}
