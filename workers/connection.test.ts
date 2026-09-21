import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.REDIS_URL = "redis://localhost:6379";
});

describe("redisConnection", () => {
  it("falha rápido em vez de enfileirar comandos indefinidamente numa conexão que nunca fica pronta", async () => {
    // Bug real reproduzido em produção (2026-09-21): causa raiz foi um
    // REDIS_URL corrompido na Vercel (corrigido na env var), mas essa
    // config de timeouts/retry continua valendo como defesa contra
    // qualquer futuro problema de conectividade — sem ela, um comando
    // preso na offline queue esperando uma conexão que nunca fecha nem
    // termina de abrir trava a UI por minutos em vez de falhar rápido.
    // Ver comentário completo em workers/connection.ts.
    const { redisConnection } = await import("./connection");
    expect(redisConnection.options.connectTimeout).toBe(5_000);
    expect(redisConnection.options.commandTimeout).toBe(8_000);
    expect(redisConnection.options.maxRetriesPerRequest).toBe(1);
    expect(redisConnection.options.lazyConnect).toBe(true);

    const retryStrategy = redisConnection.options.retryStrategy;
    expect(retryStrategy).toBeTypeOf("function");
    expect(retryStrategy!(1)).toBe(500);
    expect(retryStrategy!(4)).toBeNull(); // para de tentar depois de 3 tentativas
  });
});
