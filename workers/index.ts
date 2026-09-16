import { redisConnection } from "./connection";
// Instancia a fila para validar a configuração já nesta fase; nenhum
// consumer é registrado ainda — isso acontece a partir da Fase 1.
import "./queues";

async function main() {
  const pong = await redisConnection.ping();
  console.log(`[workers] conexão com Redis OK (${pong}). Nenhum worker registrado ainda.`);
}

// TODO(Fase 1): quando houver workers/consumers reais rodando como processo
// de longa duração, chamar redisConnection.quit() e fechar os workers aqui
// para permitir um shutdown gracioso do container.
process.on("SIGTERM", () => {
  redisConnection.quit().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  redisConnection.quit().finally(() => process.exit(0));
});

main().catch((err) => {
  console.error("[workers] falha ao conectar no Redis:", err);
  process.exit(1);
});
