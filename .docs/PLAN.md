# Milestones — Puzzle Records Social Automation

Cada fase é um incremento entregável e testável isoladamente antes de avançar para a próxima (ver Seção 7 do `PRD.md`). A numeração (Fase 0–5) é a mesma usada em `Skills_Puzzle_Records.md`.

## Fase 0 — Fundação

**Status (2026-09-16)**: código implementado, revisado (3 rodadas de review + auditoria de bugs pós-deploy + alinhamento de papéis com o Supabase real) e commitado em `main`. Deploy inicial em produção na Vercel **feito** (build passando). Credenciais reais do Supabase já configuradas em `.env.local`; falta aplicar a migration, obter uma credencial de Redis com permissão de escrita, e configurar as env vars na Vercel — ver checklist abaixo.

**Objetivo**: ter um esqueleto de aplicação rodando em produção, com autenticação e permissões, antes de qualquer lógica de pipeline.

**Entregáveis**:
- [x] Scaffold Next.js (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui.
- [x] Projeto Supabase: `profiles` **já existe em produção** (reaproveitado de uma versão anterior do produto, com RLS e papéis próprios — `equipe_conteudo`/`editorial`/`admin`; ver `lib/auth/permissions.ts`) e **não deve ser recriado**. Falta só aplicar a migration de `audit_log` em `supabase/migrations/00000000000001_add_audit_log.sql`, ainda **não aplicada** no projeto Supabase real (ação manual pendente).
- [x] Autenticação por e-mail/senha (`app/login`), proteção de rota por sessão e papel (`proxy.ts` — Next.js 16 renomeou `middleware.ts`), shell de dashboard com navegação condicionada ao papel (`app/dashboard`, `components/layout`).
- [x] Estrutura de fila Redis + BullMQ criada (sem jobs reais ainda) em `/workers`, pronta para os workers das próximas fases.
- [x] Deploy inicial na Vercel: projeto `puzzle_records_new` criado e linkado ao repositório GitHub, build corrigido (conflito de peer dependency `@types/node`/`vitest` que quebrava `npm install` na Vercel) e deploy de produção **respondendo** em `https://puzzlerecordsnew.vercel.app` — build OK, porém rotas retornam 500 em runtime até as credenciais reais serem configuradas (ver pendências).
- [x] Auditoria de código pós-deploy encontrou e corrigiu 2 bugs no fluxo de auth: `proxy.ts` forwardava um header `Cookie` desatualizado após refresh de sessão (podia deslogar usuário recém-autenticado uma camada abaixo, em Server Components) e a validação de `profiles.role` estava duplicada e divergente entre `proxy.ts` e `app/dashboard/layout.tsx` (agora centralizada em `isUserRole()` em `lib/auth/permissions.ts`).

**Pendências manuais antes de considerar a fase 100% pronta**:
1. ~~Preencher `.env.local` com credenciais reais do Supabase~~ — feito. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já estão em `.env.local` (não versionado).
2. **Redis/Upstash**: a connection string recebida usa o usuário `default_ro` — confirmado via teste real que é **somente leitura** (`NOPERM` em `SET`). BullMQ precisa escrever para enfileirar jobs. Falta obter a connection string com o usuário `default` (leitura/escrita) na aba Details do Upstash.
3. Aplicar a migration `supabase/migrations/00000000000001_add_audit_log.sql` no projeto Supabase real (só cria `audit_log`; `profiles` já existe e não deve ser recriado — o usuário real já está com `role = 'admin'`) — ainda não aplicada, precisa ser colada no SQL Editor do Supabase Studio (sem acesso à connection string direta do Postgres para automatizar via CLI).
4. Configurar as mesmas 4 variáveis (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`) em Project Settings → Environment Variables no projeto Vercel e redeployar.
5. Rodar o checklist de QA manual (Task 2 de `docs/plans/2026-09-16-fase-0-fechamento.md`) contra o Supabase real, local e em produção.

**Critério de pronto**: usuário consegue logar, ver um dashboard vazio, e o deploy responde em produção. Permissões por papel bloqueiam/liberam telas corretamente. *(Deploy responde ✅; login/permissões reais ainda bloqueados pela pendência #1-3 acima.)*

## Fase 1 — Ingestão

**Status (2026-09-17)**: código implementado, passou por **duas rodadas completas de revisão** (revisão por tarefa + revisão de todo o branch + revisão independente fresca pós-merge) e está **commitado e pushado em `origin/main`** do repositório `Puzzle_Records_new` (commits `b885546..a09b97c`, 19 commits). Entregáveis de produção concluídos: `lib/ingestion/pipeline-items.ts` + `lib/ingestion/google-drive.ts` + `lib/ingestion/telegram.ts`, webhooks configurados, Kanban board leitura acessível em `/dashboard/kanban`, 21 testes passando, build de produção verificado sem as credenciais da Fase 1 configuradas.

**Bugs corrigidos nas duas rodadas de revisão** (16 no total, nenhum pendente conhecido no código):
- Rodada 1 (revisão de todo o branch): build quebrava sem `TELEGRAM_BOT_TOKEN` (init do bot preguiçoso agora), `proxy.ts` rodava em `/api/*` desnecessariamente (matcher corrigido), autenticação falhava aberta quando `TELEGRAM_WEBHOOK_SECRET`/`CRON_SECRET` não estavam configurados (agora falha fechada via `requireEnv()`), token do bot podia vazar em logs (redigido), chamadas ao Drive sem suporte a Drive Compartilhado (`supportsAllDrives`/`includeItemsFromAllDrives` adicionados).
- Rodada 2 (revisão independente fresca): canal de push notification do Drive (`changes.watch`) ainda faltava `includeItemsFromAllDrives` (webhook nunca dispararia no Drive Compartilhado real), TTL do canal não era explícito, checagem do token do webhook do Drive era a única que não usava `requireEnv()` (falhava aberta com string vazia) e não era constant-time, **bot do Telegram aceitava mídia de qualquer pessoa sem allowlist** (agora falha fechada exigindo `TELEGRAM_ALLOWED_CHAT_IDS`), autor de itens do Drive sempre `null` em Drive Compartilhado (fallback para `lastModifyingUser` adicionado), pastas/Google Docs soltos na pasta observada viravam cards permanentes no Kanban (filtro de mimeType adicionado), timeout de 10s do webhook do Telegram curto demais para vídeos grandes (aumentado), `updated_at` de `pipeline_items` nunca era atualizado (trigger adicionado na migration, que ainda não foi aplicada em produção), script de setup do Telegram não validava env vars antes de registrar o webhook.

**⚠️ Deploy na Vercel — BLOQUEADO, precisa de decisão humana antes de prosseguir**: ao tentar fazer o deploy desta fase, foi descoberto que a única conta/projeto Vercel acessível (`puzzle-records-bldm`, plano **Hobby**) está linkado ao repositório GitHub `CoimbraViih/Puzzle_Records` (**sem** `_new`) — não a `Puzzle_Records_new`, que é o repositório deste projeto. Esse projeto Vercel já está em produção real com um codebase completamente diferente e muito mais avançado (integração n8n, Cut.Pro, aprovação via WhatsApp, publicação Zernio já ativa, múltiplos milestones M22/M23 fechados) do que o descrito neste `PLAN.md`. **Nenhum deploy foi feito** para evitar sobrescrever uma aplicação de produção ativa e não relacionada. Decisão pendente do usuário: (a) criar um projeto Vercel novo e próprio para `Puzzle_Records_new`, ou (b) esclarecer a relação real entre os dois repositórios antes de decidir onde este código deve rodar em produção. **Além disso**, o plano Hobby confirmado só suporta crons diários — os crons de `vercel.ts` (`/api/drive/poll` a cada 5 min, `/api/drive/renew-channel` diário) podem não rodar na cadência desejada até upgrade para o plano Pro; isso precisa ser verificado no primeiro deploy real, seja qual for o projeto escolhido.

**⚠️ AVISO ARQUITETURAL — CRÍTICO PARA FASE 2**: webhooks escrevem diretamente no Supabase de forma **síncrona** — **NÃO usam a fila BullMQ** (`workers/queues.ts`) que já existe. Esta foi uma decisão explícita: Vercel Serverless Functions não conseguem manter um Worker BullMQ ativo sem infra adicional (padrão cron-drain ou host sempre-ligado), que foi adiada. **Esta lacuna DEVE ser preenchida antes da Fase 2 começar**, pois a geração de legenda genuinamente precisa de um consumidor de fila assíncrono. Fase 2 não pode prosseguir sem resolver isso primeiro.

**Objetivo**: material bruto entra no sistema por dois canais e aparece no Kanban como "recebido".

**Entregáveis**:
- [x] Integração com Google Drive API: watch (webhook) na pasta observada + polling de segurança (5 min) para não perder eventos, channel renewal automático (1x/dia) via vercel cron, implementado em `lib/ingestion/google-drive.ts` e `app/api/drive/*.ts`.
- [x] Bot do Telegram para upload rápido de material bruto, com download automático de mídia para bucket `raw-media` do Supabase Storage, implementado em `lib/ingestion/telegram.ts` e `app/api/telegram/webhook/route.ts`.
- [x] Tabelas Supabase: `pipeline_items` (dedup via unique(`origin`, `external_id`)) e `drive_sync_state`, migration em `supabase/migrations/00000000000002_add_pipeline_items.sql` (ainda não aplicada no projeto real).
- [x] Item criado no Kanban no status "recebido" para cada entrada (via `upsertPipelineItem` em `lib/ingestion/pipeline-items.ts`), com metadados de origem (`drive`/`telegram`) e autor preenchidos.
- [x] Kanban board em `/dashboard/kanban`: 6 colunas (recebido → legenda → renderizando → aguardando_aprovacao → agendado → publicado), read-only, populado de `pipeline_items`.
- [x] Testes: 20+ testes passando, typecheck clean, build de produção válido.

**Pendências manuais antes de considerar a fase 100% pronta**:
1. **Decidir o projeto Vercel de destino** (ver aviso de deploy acima) antes de qualquer deploy — criar projeto novo linkado a `Puzzle_Records_new`, ou esclarecer a relação com o projeto `Puzzle_Records` já existente.
2. Aplicar a migration `supabase/migrations/00000000000002_add_pipeline_items.sql` no projeto Supabase real (SQL Editor do Supabase Studio — sem acesso direto via CLI).
3. **Google Drive**: criar serviço Google (via Google Cloud Console), compartilhar a pasta observada (Drive Compartilhado/Shared Drive confirmado) com o service account, guardar credenciais em `.env.local` e Vercel.
4. **Telegram**: criar bot via @BotFather, obter o `TELEGRAM_BOT_TOKEN`, e decidir a lista de chat/user IDs autorizados a usar o bot (`TELEGRAM_ALLOWED_CHAT_IDS`) — o bot agora recusa qualquer remetente não autorizado por padrão (falha fechada).
5. Gerar secrets: `GOOGLE_DRIVE_WEBHOOK_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET` (tokens aleatórios para validação).
6. Configurar as 9 env vars novas (4 Google + 4 Telegram, incluindo `TELEGRAM_ALLOWED_CHAT_IDS` + 1 cron) em `.env.local` e em Project Settings → Environment Variables no projeto Vercel escolhido.
7. Verificar se o plano Vercel escolhido suporta a cadência de cron desejada (`/api/drive/poll` a cada 5 min precisa de plano Pro; Hobby só roda diário).
8. Executar `scripts/setup-telegram-webhook.ts` contra o ambiente de produção (uma única vez, registra o webhook permanentemente).
9. Rodar o checklist de QA manual (Task 13 do plano) end-to-end: um arquivo solto no Drive e uma foto/vídeo enviada ao Telegram (de um chat autorizado) devem aparecer no Kanban em poucos segundos, verificar dedup.

**Critério de pronto**: um arquivo solto na pasta do Drive ou enviado ao bot aparece no Kanban em poucos segundos, sem duplicação mesmo se o webhook falhar e o polling pegar o mesmo item. *(Código pronto ✅; QA manual pendente — será completado em Task 13.)*

## Fase 2 — Geração de legenda (IA)

**Status (2026-09-17)**: código implementado e commitado em `worktree-fase-2-3-5-pipeline`. A lacuna arquitetural crítica identificada ao final da Fase 1 (webhooks gravando direto no Supabase, sem consumidor de fila) foi resolvida antes de começar esta fase: `workers/queues.ts` agora roda pelo padrão **cron-drain** — o cron `/api/queue/process` (`vercel.ts`, a cada 5 min) drena a fila BullMQ dentro de uma Serverless Function, em vez de depender de um worker sempre-ligado.

**Entregáveis**:
- [x] Colunas de legenda/render/publicação e tabela de auditoria de eventos de sistema adicionadas via migration `supabase/migrations/00000000000003_add_caption_render_publish.sql` (ainda não aplicada no projeto real — ver pendências).
- [x] Cliente OpenRouter (`lib/captioning/`) com chat completions em **structured output / JSON schema** (manchete + corpo), prompt com instrução explícita de não inventar fatos sobre pessoas reais.
- [x] `JSON.parse` da resposta da OpenRouter protegido contra retorno malformado (fix pós-review).
- [x] Processor de geração de legenda consumindo itens em "recebido" via fila, disparado automaticamente a partir da ingestão, avançando o item para "legenda".

**Pendências**:
1. `OPENROUTER_API_KEY` real ainda não preenchida — hoje qualquer chamada real falha; só testável quando a credencial for configurada (ver checklist de QA).
2. Migration `00000000000003` (ver Fase 5, item de pendências) ainda não aplicada no Supabase real.

**Critério de pronto**: item processado recebe legenda estruturada e transita de status automaticamente; falhas de geração ficam visíveis, não travam a fila. *(Código pronto ✅; validação end-to-end com credencial real pendente — Step 3 do checklist de QA abaixo.)*

## Fase 3 — Render (Creatomate)

**Status (2026-09-17)**: código implementado e commitado. Utilitário de conversão UTC → America/Sao_Paulo criado (`lib/time/`) como base compartilhada para esta fase e a Fase 5.

**Entregáveis**:
- [x] Resolução de mídia renderizável: signed URL do Supabase Storage com fallback de download sob demanda do Drive quando necessário.
- [x] Cliente Creatomate (`lib/rendering/creatomate-client.ts`) e builder de `modifications` configurável por env vars (`CREATOMATE_LAYER_HEADLINE`, `CREATOMATE_LAYER_PHOTO_1`, `CREATOMATE_LAYER_PHOTO_2`, `CREATOMATE_LAYER_BADGE`), evitando hardcode de nomes de camada do template.
- [x] Processor de render (dispara job assíncrono no Creatomate), webhook de conclusão em `app/api/creatomate/webhook/route.ts`, e script de smoke test (`npm run creatomate:smoke-test`, `scripts/creatomate-smoke-test.ts`).
- [x] Falha ao gravar `render_error` no banco agora é registrada em vez de silenciosa (fix pós-review).
- [x] Item avança de "legenda" para "renderizando" e, ao concluir (via webhook), o Kanban passa a exibir o link de render.

**Pendências**:
1. **O template do Creatomate ainda não existe** — precisa ser desenhado manualmente no editor visual (linguagem de design de referência: manchete, foto dupla, selo "AGORA/IMPACTO", card de perfil do Instagram) antes que `npm run creatomate:smoke-test` possa rodar contra a API de verdade. Sem template real, o código está implementado mas não verificado ponta a ponta.
2. `CREATOMATE_API_KEY`/`CREATOMATE_TEMPLATE_ID`/`CREATOMATE_WEBHOOK_SECRET` ainda vazios em `.env.local`.

**Critério de pronto**: item com legenda gera vídeo correspondente automaticamente; troca de versão de template só entra em produção se o smoke test passar. *(Código pronto ✅; smoke test contra template real ainda não executado — depende da pendência #1 acima.)*

## Fase 4 — Aprovação (Telegram)

**Status (2026-09-17)**: **pulada nesta versão de teste, por decisão explícita do usuário.** O item avança direto de "renderizando" para publicação (Fase 5) sem gate de aprovação humana — ver `lib/publishing/publish-post.ts`, que já lê o item recém-renderizado e chama `getZernioClient().publish(...)` sem checar nenhum campo de aprovação.

**Objetivo**: nenhum vídeo é publicado sem confirmação humana explícita.

**Entregáveis**:
Nenhum entregável foi construído nesta fase. A fase foi explicitamente pulada em favor de um release initial rápido (MVP sem gate de aprovação). Isso contraria a "regra de ouro" original do produto (nenhum post vai ao ar sem aprovação humana explícita — ver `.docs/CLAUDE.md`) e **precisa ser implementada antes de qualquer uso real em produção** com conteúdo que envolva pessoas reais.

**Critério de pronto**:
Não foi atentado nesta versão. Pendência explícita registrada para uma iteração futura — ver item 1 da lista de pendências gerais no final deste arquivo.

## Fase 5 — Publicação e Dashboard

**Status (2026-09-17)**: código implementado e commitado, cobrindo o núcleo de publicação e um MVP de dashboard (Início, Calendário, Analytics).

**Entregáveis**:
- [x] Interface `ZernioClient` (`lib/publishing/zernio-client.ts`) com `MockZernioClient` funcional (`lib/publishing/mock-zernio-client.ts`, loga `[zernio:mock] publicaria...` no console e simula sucesso) e `RealZernioClient` (`lib/publishing/real-zernio-client.ts`) implementado contra a API real (`POST /v1/posts` com `publishNow: true` e `x-request-id` = `pipelineItemId` para idempotência, `GET /v1/analytics?postId=` para métricas). `getZernioClient()` escolhe a implementação real só se `ZERNIO_API_KEY` estiver preenchida — como a chave real já foi fornecida pelo usuário, o pipeline agora publica de verdade em vez de usar o mock.
- [x] Processor de publicação imediata (`lib/publishing/publish-post.ts`) com error-handling robusto: grava `publish_error` em caso de falha, registra `publish_post_id`/`publish_permalink`/`published_at` em caso de sucesso, e emite evento de auditoria (`logSystemAuditEvent`) a cada transição de status.
- [x] Kanban (`/dashboard/kanban`) agora exibe legenda, link de render, link de publicação e erros por etapa.
- [x] Dashboard Início (`/dashboard`) com contagem de itens por status.
- [x] Calendário editorial (`/dashboard/calendario`) e Analytics (`/dashboard/analytics`) em formato MVP, com escopo de rota corrigido e fallback para não quebrar a página inteira se um item individual falhar ao buscar analytics.
- [x] Conversão de fuso horário UTC → America/Sao_Paulo: utilitário criado na Fase 3 e usado no calendário/analytics (não verificada contra timestamps reais do Zernio em produção ainda).

**Pendências**:
1. ~~Publicação real no Instagram ainda não está ativa~~ — `RealZernioClient` implementado (ver acima) e `ZERNIO_API_KEY` já configurada em `.env.local`. Falta apenas preencher `ZERNIO_INSTAGRAM_ACCOUNT_ID` (accountId do Instagram no Zernio, distinto do `ZERNIO_API_KEY`) e validar de ponta a ponta com um post real (checklist de QA abaixo).
2. **Relatórios/exportação e busca/filtros completos do dashboard** (item do PRD Fase 5) **ficam fora deste plano** — não implementados; pendência para uma iteração futura.
3. Migrations já aplicadas pelo usuário no Supabase real (confirmado 2026-09-17).
4. **Cadência de cron compartilhada com a pendência #7 da Fase 1**: o novo cron `/api/queue/process` (`*/5 * * * *`, drena a fila de legenda/render/publicação) tem exatamente o mesmo risco não verificado já registrado para `/api/drive/poll` — o plano Vercel Hobby confirmado só roda crons diários, então nenhum dos dois crons de 5 em 5 minutos tem cadência garantida até a conta ser migrada para o plano Pro (ou até isso ser testado no primeiro deploy real). Resolver os dois juntos quando a decisão de projeto/plano Vercel for tomada.

**Critério de pronto**: post aprovado é publicado/agendado corretamente no Instagram, horários exibidos batem com America/Sao_Paulo, e o dashboard mostra analytics reais vindos do Zernio. *(Código e mock funcionando ✅; publicação real no Instagram, template do Creatomate e gate de aprovação continuam pendentes — ver checklist de QA abaixo.)*

## Pendências gerais registradas ao fechar as Fases 2/3/5

1. **Gate de aprovação (Fase 4) foi pulado por decisão do usuário** nesta versão de teste — precisa ser implementado antes de qualquer uso real em produção com pessoas reais envolvidas (ver seção Fase 4 acima). **Isso continua valendo mesmo com `RealZernioClient` implementado**: o pipeline publica de verdade no Instagram sem revisão humana.
2. ~~`RealZernioClient` continua como stub~~ — implementado (`lib/publishing/real-zernio-client.ts`) usando a documentação pública da API (base `https://zernio.com/api`, `POST /v1/posts`, `GET /v1/analytics`). Falta só `ZERNIO_INSTAGRAM_ACCOUNT_ID` no `.env.local` e validação end-to-end com um post real.
3. **Template do Creatomate está sendo criado pelo usuário** no editor visual — falta preencher `CREATOMATE_LAYER_HEADLINE`/`CREATOMATE_LAYER_PHOTO_1`/`CREATOMATE_LAYER_PHOTO_2`/`CREATOMATE_LAYER_BADGE` em `.env.local` (hoje vazios) e então rodar `npm run creatomate:smoke-test` contra a API de verdade.
4. **Relatórios/exportação e busca/filtros completos do dashboard** (Fase 5 do PRD) ficam fora deste plano — pendência futura.
5. Migrations aplicadas pelo usuário no Supabase real (confirmado 2026-09-17).
6. **`REDIS_URL` e `OPENROUTER_API_KEY` ainda vazios em `.env.local`** — sem `REDIS_URL` (leitura/escrita) o BullMQ não enfileira nada e a Fase 2 não roda; sem `OPENROUTER_API_KEY` a geração de legenda falha em toda tentativa.
7. **Cadência de cron do plano Vercel Hobby**: `/api/queue/process` soma-se a `/api/drive/poll` (pendência #7 da Fase 1) como cron de 5 em 5 minutos sem confirmação de que o plano contratado suporta essa cadência.

## Checklist de QA manual end-to-end (Task 13)

Executar depois que todas as credenciais reais estiverem configuradas:

1. Aplicar as 3 migrations pendentes no Supabase Studio (`audit_log`, `pipeline_items`, colunas novas desta fase — `00000000000003_add_caption_render_publish.sql`).
2. Preencher `OPENROUTER_API_KEY` real.
3. Criar o template no Creatomate, preencher `CREATOMATE_API_KEY`/`CREATOMATE_TEMPLATE_ID`/nomes de camada, rodar `npm run creatomate:smoke-test` e confirmar sucesso.
4. Deixar `ZERNIO_API_KEY` **vazio** propositalmente nesta primeira rodada (usa o mock) — subir uma foto de teste pelo Telegram e acompanhar no Kanban: `recebido` → `legenda` → `renderizando` → `publicado`, checando os logs do endpoint `/api/queue/process` e o console (`[zernio:mock] publicaria...`).
5. Confirmar no Supabase que `audit_log` recebeu uma linha para cada transição de status do item de teste.
6. Assim que o usuário fornecer a documentação real do Zernio: implementar `RealZernioClient` (fora deste plano), preencher `ZERNIO_API_KEY`/`ZERNIO_API_BASE_URL`/`ZERNIO_INSTAGRAM_ACCOUNT_ID`, repetir o teste de ponta a ponta e confirmar que o post aparece de verdade no Instagram.
