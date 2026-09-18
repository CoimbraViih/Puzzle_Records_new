import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest, requireEnv } from "@/lib/ingestion/cron-auth";
import { captionQueue, renderQueue, publishQueue } from "@/workers/queues";
import { drainQueue } from "@/lib/queue/drain";
import { acquireDrainLock, releaseDrainLock } from "@/lib/queue/lock";
import { processCaptionJob } from "@/lib/captions/generate-caption";
import { processRenderJob } from "@/lib/render/generate-render";
import { processPublishJob } from "@/lib/publishing/publish-post";

export const dynamic = "force-dynamic";
// Default conservador enquanto a decisão Vercel Hobby vs Pro está em aberto
// (pendência #7 do `.docs/PLAN.md`): o limite do plano Hobby é bem menor que
// os 280s originais. Os orçamentos abaixo somam ~55s, dentro deste envelope.
export const maxDuration = 60;

const CAPTION_BUDGET_MS = 20_000;
const RENDER_BUDGET_MS = 20_000;
const PUBLISH_BUDGET_MS = 15_000;
// TTL um pouco maior que o orçamento total, para o lock nunca sobreviver a
// uma invocação congelada/morta pela plataforma.
const DRAIN_LOCK_TTL_MS = 300_000;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Um drain por vez (ver lib/queue/lock.ts). Não conseguir o lock é um
  // resultado normal e esperado — outra invocação já está drenando.
  if (!(await acquireDrainLock(DRAIN_LOCK_TTL_MS))) {
    return NextResponse.json({ ok: true, skipped: "already draining" });
  }

  try {
    const captions = await drainQueue(captionQueue, processCaptionJob, { timeBudgetMs: CAPTION_BUDGET_MS });
    const renders = await drainQueue(renderQueue, processRenderJob, { timeBudgetMs: RENDER_BUDGET_MS });
    const publishes = await drainQueue(publishQueue, processPublishJob, { timeBudgetMs: PUBLISH_BUDGET_MS });

    return NextResponse.json({ ok: true, processed: { captions, renders, publishes } });
  } finally {
    await releaseDrainLock();
  }
}
