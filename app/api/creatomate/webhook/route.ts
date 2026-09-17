import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/ingestion/cron-auth";
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

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const itemId = request.nextUrl.searchParams.get("item");
  const expectedToken = requireEnv("CREATOMATE_WEBHOOK_SECRET");
  if (!safeCompare(token, expectedToken) || !itemId) {
    return NextResponse.json({ error: "invalid webhook" }, { status: 401 });
  }

  const payload = (await request.json()) as { status?: string; url?: string; error_message?: string };
  const supabase = getServiceRoleClient();

  if (payload.status === "succeeded" && payload.url) {
    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({ render_url: payload.url, render_error: null })
      .eq("id", itemId);
    if (updateError) {
      console.error("[creatomate/webhook] falha ao salvar render_url", updateError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    await logSystemAuditEvent({ action: "render_completed", entityId: itemId, metadata: { url: payload.url } });

    // Gate de aprovação (Fase 4) foi deliberadamente pulado nesta versão de
    // teste — publicação dispara automaticamente ao terminar o render. Ver
    // "Global Constraints" no topo deste plano.
    await publishQueue.add("publish", { pipelineItemId: itemId });
    triggerQueueDrain();
  } else if (payload.status === "failed") {
    await supabase
      .from("pipeline_items")
      .update({ render_error: payload.error_message ?? "render falhou no Creatomate" })
      .eq("id", itemId);
  }

  return NextResponse.json({ ok: true });
}
