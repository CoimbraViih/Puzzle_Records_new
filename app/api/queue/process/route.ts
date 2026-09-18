import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest, requireEnv } from "@/lib/ingestion/cron-auth";
import { drainAllQueues } from "@/lib/queue/drain-all";

export const dynamic = "force-dynamic";
// Default conservador enquanto a decisão Vercel Hobby vs Pro está em aberto
// (pendência #7 do `.docs/PLAN.md`): o limite do plano Hobby é bem menor que
// os 280s originais. Os orçamentos em lib/queue/drain-all.ts somam ~55s,
// dentro deste envelope.
export const maxDuration = 60;

/**
 * Sem entrada própria em `vercel.ts` (plano Hobby só permite 2 crons diários
 * no total — ver pendência #7 do PLAN.md). Continua existindo como alvo do
 * disparo imediato fire-and-forget (`triggerQueueDrain`, chamado logo após
 * cada enqueue) e é drenado também 1x/dia pelo cron consolidado em
 * `/api/cron/daily`.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await drainAllQueues();
  return NextResponse.json(result);
}
