import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.REDIS_URL = "redis://localhost:6379";
});

describe("redisConnection", () => {
  it("falha rápido em vez de enfileirar comandos indefinidamente numa conexão que nunca fica pronta", async () => {
    // Bug real reproduzido em produção (2026-09-21), duas tentativas:
    // 1) commandTimeout sozinho não bastou — comandos presos na offline
    //    queue esperando uma conexão que nunca fecha nem termina de abrir
    //    podiam ficar retry-ando pra sempre (retryStrategy sem teto).
    // 2) enableOfflineQueue=false quebrou o caminho feliz (rejeita até o
    //    1º comando de uma conexão lazyConnect nunca usada — testado e
    //    descartado).
    // 3) fix real: manter a offline queue padrão, mas com retryStrategy de
    //    teto finito — depois de esgotar as tentativas, os comandos
    //    pendentes são rejeitados em vez de esperar para sempre.
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
