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
  lazyConnect: true,
  // --- Bug real reproduzido em produção (2026-09-21): itens ficavam presos
  // em "recebido", com a Server Action travada em "Enviando..." por mais de
  // 2 minutos (às vezes indefinidamente), sem NENHUM erro no cliente.
  //
  // Causa raiz de verdade, achada só depois: o `REDIS_URL` configurado em
  // produção na Vercel estava CORROMPIDO (faltava o prefixo `rediss://` e
  // sobrava um `%22` no final, algo como `//default:...@host:6379%22` em vez
  // de `rediss://default:...@host:6379`) — provavelmente colado com aspas
  // literais na hora de configurar a env var. Isso fazia toda tentativa de
  // conexão falhar com `EINVAL`. Corrigido direto na env var da Vercel.
  //
  // Por que isso travava para sempre em vez de dar erro na hora: sem os
  // timeouts abaixo, um comando emitido enquanto a conexão ainda não está
  // pronta fica parado na "offline queue" do ioredis esperando a conexão
  // ficar pronta — e com `retryStrategy` padrão (sem teto, backoff
  // indefinido), o ioredis tentava reconectar pra sempre contra uma URL que
  // nunca ia funcionar, então o comando nunca era liberado nem para falhar.
  // `commandTimeout` sozinho (1ª tentativa) não bastou porque só limita
  // comandos já ENVIADOS esperando resposta, não os presos na offline queue.
  //
  // Os timeouts abaixo continuam valendo mesmo com a env var corrigida: são
  // uma defesa de verdade contra qualquer futuro problema de conectividade
  // (rede, Upstash fora do ar, etc.) — sem eles, qualquer coisa desse tipo
  // volta a travar a UI por minutos em vez de falhar rápido e deixar a
  // reconciliação (lib/pipeline/reconcile.ts) reprocessar depois. Nenhum
  // comando de bloqueio roda nesta conexão (não há BullMQ Worker no
  // projeto — só Queue.add/getJobs via o padrão cron-drain, ver
  // lib/queue/drain.ts), então maxRetriesPerRequest pode ser finito em vez
  // de null (exigência do BullMQ é só para conexões usadas por Worker).
  connectTimeout: 5_000,
  commandTimeout: 8_000,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) return null; // desiste e rejeita comandos pendentes
    return Math.min(times * 500, 2_000);
  },
});
