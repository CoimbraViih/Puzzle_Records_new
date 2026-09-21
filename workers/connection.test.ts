import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.REDIS_URL = "redis://localhost:6379";
});

describe("redisConnection", () => {
  it("configura commandTimeout para falhar rápido em vez de travar em conexão obsoleta", async () => {
    // Bug real reproduzido em produção (2026-09-21): sem commandTimeout, um
    // comando numa conexão obsoleta (comum em serverless com reuso de
    // instância) trava por minutos em vez de falhar e permitir reconexão —
    // ver comentário em workers/connection.ts para o diagnóstico completo.
    const { redisConnection } = await import("./connection");
    expect(redisConnection.options.commandTimeout).toBe(10_000);
    expect(redisConnection.options.lazyConnect).toBe(true);
    expect(redisConnection.options.maxRetriesPerRequest).toBeNull();
  });
});
