import { describe, it, expect, vi } from "vitest";
import type { Queue, Job } from "bullmq";
import { drainQueue } from "./drain";

function fakeJob(data: unknown): Job {
  return { id: "1", data, remove: vi.fn().mockResolvedValue(undefined) } as unknown as Job;
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

  it("não trava a fila quando o handler falha — remove o job mesmo assim", async () => {
    const jobs = [fakeJob({ n: 1 })];
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValueOnce(jobs).mockResolvedValueOnce([]),
    } as unknown as Queue;

    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const processed = await drainQueue(queue, handler, { timeBudgetMs: 5000 });

    expect(processed).toBe(1);
    expect(jobs[0].remove).toHaveBeenCalled();
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
});
