import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest, requireEnv } from "@/lib/ingestion/cron-auth";
import { syncDriveChanges } from "@/lib/ingestion/google-drive";
import { drainAllQueues } from "@/lib/queue/drain-all";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron único consolidando o poll de segurança do Drive (Fase 1) e o drain da
 * fila (Fase 2/3/5) numa única invocação diária. Existe só porque o plano
 * Vercel Hobby permite no máximo 2 cron jobs no total e nenhum mais frequente
 * que 1x/dia (ver pendência #7 do `.docs/PLAN.md`) — sem essa consolidação,
 * os 3 crons que o pipeline precisaria (renew-channel + poll + queue/process)
 * excedem o limite e o deploy é rejeitado pela própria Vercel.
 *
 * Trade-off aceito explicitamente pelo usuário: itens agora podem esperar até
 * ~24h para avançar de etapa via este cron (webhooks continuam imediatos; só
 * a rede de segurança fica lenta). Reverter para os crons de 5 em 5 minutos
 * originais (`/api/drive/poll` + `/api/queue/process` direto no vercel.ts)
 * assim que a conta migrar para o plano Pro — nenhuma mudança de código
 * necessária além do `vercel.ts`.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const drive = await syncDriveChanges();
  const queue = await drainAllQueues();

  return NextResponse.json({ ok: true, drive, queue });
}
