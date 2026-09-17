import type { Queue } from "bullmq";

export interface DrainOptions {
  batchSize?: number;
  timeBudgetMs?: number;
}

/**
 * Consome jobs de uma fila BullMQ dentro de um orçamento de tempo, sem
 * depender de um Worker de longa duração (que a Vercel serverless não
 * hospeda). Chamado a partir de um endpoint com cron + disparo imediato —
 * mesmo padrão redundante já usado na ingestão (webhook + poll, Fase 1).
 */
export async function drainQueue<T>(
  queue: Queue<T>,
  handler: (data: T) => Promise<void>,
  options: DrainOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 20;
  const deadline = Date.now() + (options.timeBudgetMs ?? 60_000);
  let processed = 0;

  while (Date.now() < deadline) {
    const jobs = await queue.getJobs(["waiting", "delayed"], 0, batchSize - 1);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      try {
        await handler(job.data);
      } catch (err) {
        console.error(`[queue:${queue.name}] job ${job.id} falhou:`, err);
      } finally {
        await job.remove();
        processed += 1;
      }
    }
  }

  return processed;
}
