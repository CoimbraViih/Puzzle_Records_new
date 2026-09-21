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
  // Bug real reproduzido em produção (2026-09-21): itens ficavam presos em
  // "recebido" com a Server Action travada em "Enviando..." por 60-120s+
  // antes de responder (às vezes nunca). Causa: em runtime serverless com
  // reaproveitamento de instância (Vercel Fluid Compute), esta conexão pode
  // sobreviver entre invocações — se a rede/NAT derrubar o socket
  // silenciosamente nesse intervalo (comum após alguns minutos ocioso),
  // ioredis só descobre isso quando o próximo comando (ex.: captionQueue.add)
  // fica esperando resposta indefinidamente até o timeout de TCP do SO, que
  // por padrão é da ordem de minutos — não segundos. commandTimeout força
  // qualquer comando sem resposta a falhar rápido (o catch em
  // app/dashboard/kanban/actions.ts já trata isso), e o ioredis reconecta
  // sozinho a partir daí. Nenhum comando de bloqueio roda nesta conexão
  // (não há BullMQ Worker no projeto — só Queue.add/getJobs via o padrão
  // cron-drain, ver lib/queue/drain.ts), então é seguro usar commandTimeout
  // aqui sem interferir em nada.
  commandTimeout: 10_000,
});
