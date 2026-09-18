import type { Queue } from "bullmq";

export interface DrainOptions {
  batchSize?: number;
  timeBudgetMs?: number;
}

/**
 * Número máximo de tentativas antes de descartar um job definitivamente.
 * O padrão anterior (`job.remove()` em `finally`) destruía qualquer semântica
 * de retry: uma falha transitória (429 do OpenRouter, 503 do Creatomate, blip
 * do Supabase) derrubava o job para sempre. Como não rodamos um `Worker`
 * BullMQ de verdade (sem lock/token de worker na Vercel serverless), o retry
 * é implementado por re-enfileiramento manual: o job continua em "waiting" e
 * carrega o contador `_drainAttempts` no próprio payload.
 */
export const MAX_DRAIN_ATTEMPTS = 3;

/**
 * Consome jobs de uma fila BullMQ dentro de um orçamento de tempo, sem
 * depender de um Worker de longa duração (que a Vercel serverless não
 * hospeda). Chamado a partir de um endpoint com cron + disparo imediato —
 * mesmo padrão redundante já usado na ingestão (webhook + poll, Fase 1).
 */
export async function drainQueue<T extends object>(
  queue: Queue<T>,
  handler: (data: T) => Promise<void>,
  options: DrainOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 20;
  const deadline = Date.now() + (options.timeBudgetMs ?? 60_000);
  let processed = 0;
  // Um job que falhou e voltou para "waiting" com _drainAttempts incrementado
  // não deve ser puxado de novo dentro desta MESMA invocação — o loop externo
  // re-consulta "waiting" a cada iteração e pegaria o mesmo job de novo em
  // milissegundos, esgotando MAX_DRAIN_ATTEMPTS numa rajada sem backoff em vez
  // de espalhar as tentativas entre execuções do cron (5 min de intervalo).
  const retriedThisRun = new Set<string>();

  while (Date.now() < deadline) {
    // Só "waiting": puxar "delayed" adiantaria jobs agendados de propósito.
    const jobs = (await queue.getJobs(["waiting"], 0, batchSize - 1)).filter(
      (job) => !job.id || !retriedThisRun.has(job.id),
    );
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      try {
        await handler(job.data);
        await job.remove();
        processed += 1;
      } catch (err) {
        console.error(`[queue:${queue.name}] job ${job.id} falhou:`, err);
        const attempts = ((job.data as Record<string, unknown>)?._drainAttempts as number | undefined) ?? 0;
        if (attempts + 1 >= MAX_DRAIN_ATTEMPTS) {
          console.error(`[queue:${queue.name}] job ${job.id} desistindo após ${attempts + 1} tentativas`);
          await job.remove();
        } else {
          await job.updateData({ ...job.data, _drainAttempts: attempts + 1 } as T);
          // job continua em "waiting" — será repescado só no próximo drain.
          if (job.id) retriedThisRun.add(job.id);
        }
        processed += 1;
      }
    }
  }

  return processed;
}
