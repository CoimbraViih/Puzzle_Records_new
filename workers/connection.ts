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
  // `commandTimeout` sozinho (tentativa #1) não resolveu: reproduzido de
  // novo em produção mesmo depois de configurá-lo, ainda travado após 120s+.
  // Motivo: `commandTimeout` só limita comandos que já foram ENVIADOS e
  // estão esperando resposta — um comando emitido enquanto a conexão ainda
  // não está pronta fica parado na "offline queue" do ioredis
  // (`enableOfflineQueue`, true por padrão) esperando a conexão ficar
  // pronta, e isso NÃO é coberto por `commandTimeout`. Se o handshake
  // TCP/TLS para o Upstash nunca completa (ou completa e cai silenciosamente
  // depois, comum em runtime serverless com reuso de instância — Vercel
  // Fluid Compute — quando a rede/NAT derruba o socket sem avisar) e o
  // `retryStrategy` padrão do ioredis tenta reconectar indefinidamente com
  // backoff, o comando fica esperando para sempre, sem nenhum timeout
  // aplicável.
  //
  // Fix real: `enableOfflineQueue: false` foi cogitado mas descartado —
  // combinado com `lazyConnect: true` ele rejeita até o PRIMEIRO comando
  // (aquele que dispararia a conexão inicial), porque não há fila pra
  // segurar o comando enquanto conecta. Testado e confirmado: quebra o
  // caminho feliz inteiro. Em vez disso, mantemos a offline queue padrão
  // (segura o comando durante a 1ª tentativa de conectar) mas com
  // `retryStrategy` finito: depois de esgotar as tentativas, o ioredis
  // desiste e rejeita os comandos pendentes com erro — em vez de tentar
  // reconectar com backoff para sempre enquanto os comandos ficam
  // acumulados na fila esperando uma conexão que nunca vem. Pior caso
  // limitado a ~15-20s (connectTimeout × tentativas + backoff), o catch em
  // app/dashboard/kanban/actions.ts trata o erro e devolve algo pro usuário
  // rápido, e a reconciliação (lib/pipeline/reconcile.ts) cobre o
  // reprocessamento automático depois. Nenhum comando de bloqueio roda
  // nesta conexão (não há BullMQ Worker no projeto — só Queue.add/getJobs
  // via o padrão cron-drain, ver lib/queue/drain.ts), então
  // maxRetriesPerRequest também pode ser finito em vez de null (exigência
  // do BullMQ é só para conexões usadas por Worker).
  connectTimeout: 5_000,
  commandTimeout: 8_000,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) return null; // desiste e rejeita comandos pendentes
    return Math.min(times * 500, 2_000);
  },
});
