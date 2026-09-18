import { redisConnection } from "@/workers/connection";

const DRAIN_LOCK_KEY = "queue:process:lock";

/**
 * Mutex distribuído (Redis) em volta do drain inteiro.
 *
 * O sistema é auto-reentrante: `triggerQueueDrain()` é chamado de *dentro* de
 * um drain em andamento (por `processCaptionJob`, pelo webhook do Creatomate e
 * pelos dois caminhos de ingestão), o que gera invocações sobrepostas de
 * `/api/queue/process`. Sem lock, dois drains simultâneos de `publishQueue`
 * podem pegar o mesmo job e publicar duas vezes no Instagram — sem gate de
 * aprovação humana (Fase 4 pulada), a corretude aqui é a única rede de
 * segurança.
 *
 * O compare-and-swap de status em cada processor (`.eq("status", ...)` no
 * update) é a segunda camada: mesmo sem este lock, um job duplicado vira
 * no-op. As duas proteções importam — o lock evita a corrida na prática, o
 * CAS torna cada processor provavelmente seguro se o lock algum dia sumir.
 */
export async function acquireDrainLock(ttlMs: number): Promise<boolean> {
  const result = await redisConnection.set(DRAIN_LOCK_KEY, "1", "PX", ttlMs, "NX");
  return result === "OK";
}

export async function releaseDrainLock(): Promise<void> {
  try {
    await redisConnection.del(DRAIN_LOCK_KEY);
  } catch (err) {
    console.error("[queue] falha ao liberar o lock do drain (expira sozinho pelo TTL):", err);
  }
}
