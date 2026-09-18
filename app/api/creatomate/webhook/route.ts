import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/ingestion/cron-auth";
import { isHttpsUrl } from "@/lib/http/url-safety";
import { publishQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";

export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

interface CreatomateWebhookPayload {
  id?: string;
  status?: string;
  url?: string;
  error_message?: string;
}

/**
 * Webhook de conclusão de render do Creatomate.
 *
 * Autenticação em duas camadas, por limitação da API do Creatomate: o
 * `webhook_url` é um callback só-URL — a API não aceita headers customizados
 * para a chamada de retorno (ver `lib/render/creatomate-client.ts`, que só
 * envia `webhook_url` no corpo do POST /renders). Por isso o segredo continua
 * viajando na query string (`?token=`), o que é um risco residual conhecido
 * (query strings aparecem em logs de request da Vercel, proxies e traces).
 *
 * Mitigação aceita nesta fase, em vez de uma migration de coluna de nonce
 * por render: além do segredo estático, exigimos que `payload.id` bata com o
 * `render_id` salvo no item — que é o ID opaco gerado pelo próprio Creatomate,
 * não adivinhável e diferente a cada render. Na prática isso transforma o par
 * (token estático + render_id) em uma credencial efetivamente por-render: um
 * `webhook_url` vazado de um render não pode ser reusado contra outro item nem
 * replayado depois que o item saiu de "renderizando". Um nonce próprio por
 * item continua sendo a melhoria futura ideal.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const itemId = request.nextUrl.searchParams.get("item");
  const expectedToken = requireEnv("CREATOMATE_WEBHOOK_SECRET");
  if (!safeCompare(token, expectedToken) || !itemId) {
    return NextResponse.json({ error: "invalid webhook" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as CreatomateWebhookPayload | null;
  if (!payload) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();

  // Amarra o payload ao render que o pipeline realmente iniciou para este
  // item. Resposta sempre 200 daqui pra frente: não distinguir "item não
  // existe" de "render_id não bate" evita virar um oráculo de existência.
  const { data: storedItem, error: lookupError } = await supabase
    .from("pipeline_items")
    .select("id, render_id")
    .eq("id", itemId)
    .maybeSingle();
  if (lookupError) {
    console.error("[creatomate/webhook] falha ao buscar o item", lookupError);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!storedItem || !storedItem.render_id || storedItem.render_id !== payload.id) {
    console.warn(
      `[creatomate/webhook] payload recusado para o item ${itemId}: render_id não confere (recebido=${payload.id ?? "<ausente>"})`,
    );
    return NextResponse.json({ ok: true });
  }

  if (payload.status === "succeeded" && payload.url) {
    if (!isHttpsUrl(payload.url)) {
      console.warn(`[creatomate/webhook] render_url recusada para o item ${itemId}: não é uma URL https válida`);
      return NextResponse.json({ ok: true });
    }

    const { data: updated, error: updateError } = await supabase
      .from("pipeline_items")
      .update({ render_url: payload.url, render_error: null })
      .eq("id", itemId)
      // compare-and-swap: só aceita a URL enquanto o item ainda está renderizando
      .eq("status", "renderizando")
      .select("id");
    if (updateError) {
      console.error("[creatomate/webhook] falha ao salvar render_url", updateError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      console.warn(
        `[creatomate/webhook] item ${itemId} já não estava mais em "renderizando" — webhook duplicado/atrasado ignorado.`,
      );
      return NextResponse.json({ ok: true });
    }

    await logSystemAuditEvent({ action: "render_completed", entityId: itemId, metadata: { url: payload.url } });

    // Gate de aprovação (Fase 4) foi deliberadamente pulado nesta versão de
    // teste — publicação dispara automaticamente ao terminar o render. Ver
    // "Global Constraints" no plano da Fase 2/3/5.
    await publishQueue.add("publish", { pipelineItemId: itemId });
    triggerQueueDrain();
  } else if (payload.status === "failed") {
    // O item continua em "renderizando" de propósito: não há status de erro no
    // schema desta fase, e assim ele segue visível no Kanban com o erro à vista.
    const { error: failureUpdateError } = await supabase
      .from("pipeline_items")
      .update({ render_error: payload.error_message ?? "render falhou no Creatomate" })
      .eq("id", itemId);
    if (failureUpdateError) {
      console.error(`[creatomate/webhook] falha ao registrar render_error para ${itemId}:`, failureUpdateError);
    }
  }

  return NextResponse.json({ ok: true });
}
