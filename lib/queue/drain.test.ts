import { describe, it, expect, vi } from "vitest";
import type { Queue, Job } from "bullmq";
import { drainQueue, MAX_DRAIN_ATTEMPTS } from "./drain";

function fakeJob(data: object, id = "1"): Job {
  const job = {
    id,
    data,
    remove: vi.fn().mockResolvedValue(undefined),
    updateData: vi.fn().mockImplementation(async (next: object) => {
      job.data = next;
    }),
  };
  return job as unknown as Job;
}

describe("drainQueue", () => {
  it("processa todos os jobs disponíveis e os remove", async () => {
    const jobs = [fakeJob({ n: 1 }), fakeJob({ n: 2 })];
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValueOnce(jobs).mockResolvedValueOnce([]),
    } as unknown as Queue;

    const handler = vi.fn().mockResolvedValue(undefined);
    const processed = await drainQueue(queue, handler, { timeBudgetMs: 5000 });

    expect(processed).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(jobs[0].remove).toHaveBeenCalled();
    expect(jobs[1].remove).toHaveBeenCalled();
  });

  it("não trava a fila quando o handler falha — mantém o job para retry em vez de removê-lo", async () => {
    const jobs = [fakeJob({ n: 1 })];
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValueOnce(jobs).mockResolvedValueOnce([]),
    } as unknown as Queue;

    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const processed = await drainQueue(queue, handler, { timeBudgetMs: 5000 });

    expect(processed).toBe(1);
    // Contrato novo (retry limitado): na 1ª falha o job NÃO é descartado.
    expect(jobs[0].remove).not.toHaveBeenCalled();
    expect(jobs[0].updateData).toHaveBeenCalledWith({ n: 1, _drainAttempts: 1 });
  });

  it("incrementa _drainAttempts a cada falha e só descarta na última tentativa", async () => {
    const job = fakeJob({ n: 1 });
    const handler = vi.fn().mockRejectedValue(new Error("boom"));

    for (let attempt = 1; attempt <= MAX_DRAIN_ATTEMPTS; attempt += 1) {
      const queue = {
        name: "test-queue",
        getJobs: vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce([]),
      } as unknown as Queue;
      await drainQueue(queue, handler, { timeBudgetMs: 5000 });

      if (attempt < MAX_DRAIN_ATTEMPTS) {
        expect(job.remove).not.toHaveBeenCalled();
        expect(job.updateData).toHaveBeenCalledWith({ n: 1, _drainAttempts: attempt });
      }
    }

    // Na MAX_DRAIN_ATTEMPTS-ésima falha o job é descartado de vez.
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(job.updateData).toHaveBeenCalledTimes(MAX_DRAIN_ATTEMPTS - 1);
  });

  it("respeita o orçamento de tempo e não fica presa em loop infinito", async () => {
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValue([fakeJob({ n: 1 })]), // sempre retorna 1 job "novo"
    } as unknown as Queue;

    const handler = vi.fn().mockResolvedValue(undefined);
    const start = Date.now();
    await drainQueue(queue, handler, { timeBudgetMs: 50 });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("só puxa jobs em 'waiting' (não adianta jobs 'delayed')", async () => {
    const getJobs = vi.fn().mockResolvedValue([]);
    const queue = { name: "test-queue", getJobs } as unknown as Queue;

    await drainQueue(queue, vi.fn(), { timeBudgetMs: 5000 });

    expect(getJobs).toHaveBeenCalledWith(["waiting"], 0, expect.any(Number));
  });
});
