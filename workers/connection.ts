import IORedis from "ioredis";

/**
 * Não valida REDIS_URL na importação do módulo: o `next build` faz
 * "collect page data" de toda rota — inclusive `/api/creatomate/webhook` e o
 * cron de fila —, o que importa este arquivo mesmo sem nenhuma operação de
 * fila rodar. Um throw aqui quebra `npm run build` inteiro sem REDIS_URL
 * configurada (mesma classe de bug já corrigida para o bot do Telegram na
 * Fase 1 — init preguiçoso). Com `lazyConnect: true`, a falta da env var só
 * derruba de verdade quando uma operação de fila é executada em runtime.
 */
export const redisConnection = new IORedis(process.env.REDIS_URL as string, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
