import { redisConnection } from "./connection";

async function main() {
  const pong = await redisConnection.ping();
  console.log(`[workers] conexão com Redis OK (${pong}). Nenhum worker registrado ainda.`);
}

main().catch((err) => {
  console.error("[workers] falha ao conectar no Redis:", err);
  process.exit(1);
});
