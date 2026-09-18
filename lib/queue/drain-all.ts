import { captionQueue, renderQueue, publishQueue } from "@/workers/queues";
import { drainQueue } from "./drain";
import { acquireDrainLock, releaseDrainLock } from "./lock";
import { processCaptionJob } from "@/lib/captions/generate-caption";
import { processRenderJob } from "@/lib/render/generate-render";
import { processPublishJob } from "@/lib/publishing/publish-post";

const CAPTION_BUDGET_MS = 20_000;
const RENDER_BUDGET_MS = 20_000;
const PUBLISH_BUDGET_MS = 15_000;
// TTL um pouco maior que o orçamento total, para o lock nunca sobreviver a
// uma invocação congelada/morta pela plataforma.
const DRAIN_LOCK_TTL_MS = 300_000;

export type DrainAllResult =
  | { ok: true; processed: { captions: number; renders: number; publishes: number } }
  | { ok: true; skipped: "already draining" };

/**
 * Drena as 3 filas do pipeline (legenda, render, publicação) sob um mutex —
 * chamado tanto pelo endpoint de disparo imediato (`triggerQueueDrain`)
 * quanto pelo cron consolidado (`/api/cron/daily`).
 */
export async function drainAllQueues(): Promise<DrainAllResult> {
  // Um drain por vez (ver lib/queue/lock.ts). Não conseguir o lock é um
  // resultado normal e esperado — outra invocação já está drenando.
  if (!(await acquireDrainLock(DRAIN_LOCK_TTL_MS))) {
    return { ok: true, skipped: "already draining" };
  }

  try {
    const captions = await drainQueue(captionQueue, processCaptionJob, { timeBudgetMs: CAPTION_BUDGET_MS });
    const renders = await drainQueue(renderQueue, processRenderJob, { timeBudgetMs: RENDER_BUDGET_MS });
    const publishes = await drainQueue(publishQueue, processPublishJob, { timeBudgetMs: PUBLISH_BUDGET_MS });
    return { ok: true, processed: { captions, renders, publishes } };
  } finally {
    await releaseDrainLock();
  }
}
