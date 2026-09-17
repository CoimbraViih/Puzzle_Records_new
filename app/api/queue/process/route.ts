import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest, requireEnv } from "@/lib/ingestion/cron-auth";
import { captionQueue, renderQueue, publishQueue } from "@/workers/queues";
import { drainQueue } from "@/lib/queue/drain";
import { processCaptionJob } from "@/lib/captions/generate-caption";
import { processRenderJob } from "@/lib/render/generate-render";
import { processPublishJob } from "@/lib/publishing/publish-post";

export const dynamic = "force-dynamic";
export const maxDuration = 280;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const captions = await drainQueue(captionQueue, processCaptionJob, { timeBudgetMs: 90_000 });
  const renders = await drainQueue(renderQueue, processRenderJob, { timeBudgetMs: 90_000 });
  const publishes = await drainQueue(publishQueue, processPublishJob, { timeBudgetMs: 60_000 });

  return NextResponse.json({ ok: true, processed: { captions, renders, publishes } });
}
