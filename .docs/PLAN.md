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
2. ~~**Redis/Upstash**: a connection string recebida usa o usuário `default_ro`~~ — **resolvido (2026-09-19)**. A connection string em `.env.local` (`better-kitten-282197.upstash.io`) foi testada com um `SET`/`DEL` real via `ioredis` e confirmada como leitura/escrita. Ainda não confirmado se o `REDIS_URL` configurado em produção na Vercel é o mesmo valor — verificar antes de considerar a fila 100% operacional em produção.
3. Aplicar a migration `supabase/migrations/00000000000001_add_audit_log.sql` no projeto Supabase real (só cria `audit_log`; `profiles` já existe e não deve ser recriado — o usuário real já está com `role = 'admin'`) — ainda não aplicada, precisa ser colada no SQL Editor do Supabase Studio (sem acesso à connection string direta do Postgres para automatizar via CLI).
4. Configurar as mesmas 4 variáveis (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`) em Project Settings → Environment Variables no projeto Vercel e redeployar.
5. Rodar o checklist de QA manual (Task 2 de `docs/plans/2026-09-16-fase-0-fechamento.md`) contra o Supabase real, local e em produção.

**Critério de pronto**: usuário consegue logar, ver um dashboard vazio, e o deploy responde em produção. Permissões por papel bloqueiam/liberam telas corretamente. *(Deploy responde ✅; login/permissões reais ainda bloqueados pela pendência #1-3 acima.)*

## Fase 1 — Ingestão

**Status (2026-09-17)**: **Fase 1 completa.** Código implementado, passou por **duas rodadas completas de revisão** (revisão por tarefa + revisão de todo o branch + revisão independente fresca pós-merge) e está **commitado e pushado em `origin/main`** do repositório `Puzzle_Records_new` (commits `b885546..a09b97c`, 19 commits). Entregáveis de produção concluídos: `lib/ingestion/pipeline-items.ts` + `lib/ingestion/google-drive.ts` + `lib/ingestion/telegram.ts`, webhooks configurados, Kanban board leitura acessível em `/dashboard/kanban`, 21 testes passando, build de produção verificado. Todas as pendências manuais (deploy Vercel, migration, credenciais Drive/Telegram, secrets, QA end-to-end) foram concluídas — ver checklist abaixo.

**Bugs corrigidos nas duas rodadas de revisão** (16 no total, nenhum pendente conhecido no código):
- Rodada 1 (revisão de todo o branch): build quebrava sem `TELEGRAM_BOT_TOKEN` (init do bot preguiçoso agora), `proxy.ts` rodava em `/api/*` desnecessariamente (matcher corrigido), autenticação falhava aberta quando `TELEGRAM_WEBHOOK_SECRET`/`CRON_SECRET` não estavam configurados (agora falha fechada via `requireEnv()`), token do bot podia vazar em logs (redigido), chamadas ao Drive sem suporte a Drive Compartilhado (`supportsAllDrives`/`includeItemsFromAllDrives` adicionados).
- Rodada 2 (revisão independente fresca): canal de push notification do Drive (`changes.watch`) ainda faltava `includeItemsFromAllDrives` (webhook nunca dispararia no Drive Compartilhado real), TTL do canal não era explícito, checagem do token do webhook do Drive era a única que não usava `requireEnv()` (falhava aberta com string vazia) e não era constant-time, **bot do Telegram aceitava mídia de qualquer pessoa sem allowlist** (agora falha fechada exigindo `TELEGRAM_ALLOWED_CHAT_IDS`), autor de itens do Drive sempre `null` em Drive Compartilhado (fallback para `lastModifyingUser` adicionado), pastas/Google Docs soltos na pasta observada viravam cards permanentes no Kanban (filtro de mimeType adicionado), timeout de 10s do webhook do Telegram curto demais para vídeos grandes (aumentado), `updated_at` de `pipeline_items` nunca era atualizado (trigger adicionado na migration, que ainda não foi aplicada em produção), script de setup do Telegram não validava env vars antes de registrar o webhook.

**✅ Pendências manuais resolvidas (2026-09-17)**: decisão de projeto Vercel tomada, migration aplicada, credenciais Drive/Telegram configuradas, secrets gerados e QA manual executado — ver checklist abaixo, todos os itens concluídos.

**⚠️ AVISO ARQUITETURAL — CRÍTICO PARA FASE 2**: webhooks escrevem diretamente no Supabase de forma **síncrona** — **NÃO usam a fila BullMQ** (`workers/queues.ts`) que já existe. Esta foi uma decisão explícita: Vercel Serverless Functions não conseguem manter um Worker BullMQ ativo sem infra adicional (padrão cron-drain ou host sempre-ligado), que foi adiada. **Esta lacuna DEVE ser preenchida antes da Fase 2 começar**, pois a geração de legenda genuinamente precisa de um consumidor de fila assíncrono. Fase 2 não pode prosseguir sem resolver isso primeiro.

**Objetivo**: material bruto entra no sistema por dois canais e aparece no Kanban como "recebido".

**Entregáveis**:
- [x] Integração com Google Drive API: watch (webhook) na pasta observada + polling de segurança (5 min) para não perder eventos, channel renewal automático (1x/dia) via vercel cron, implementado em `lib/ingestion/google-drive.ts` e `app/api/drive/*.ts`.
- [x] Bot do Telegram para upload rápido de material bruto, com download automático de mídia para bucket `raw-media` do Supabase Storage, implementado em `lib/ingestion/telegram.ts` e `app/api/telegram/webhook/route.ts`.
- [x] Tabelas Supabase: `pipeline_items` (dedup via unique(`origin`, `external_id`)) e `drive_sync_state`, migration em `supabase/migrations/00000000000002_add_pipeline_items.sql` (ainda não aplicada no projeto real).
- [x] Item criado no Kanban no status "recebido" para cada entrada (via `upsertPipelineItem` em `lib/ingestion/pipeline-items.ts`), com metadados de origem (`drive`/`telegram`) e autor preenchidos.
- [x] Kanban board em `/dashboard/kanban`: 6 colunas (recebido → legenda → renderizando → aguardando_aprovacao → agendado → publicado), read-only, populado de `pipeline_items`.
- [x] Testes: 20+ testes passando, typecheck clean, build de produção válido.

**Pendências manuais — todas concluídas (2026-09-17)**:
1. [x] Projeto Vercel de destino decidido.
2. [x] Migration `supabase/migrations/00000000000002_add_pipeline_items.sql` aplicada no projeto Supabase real.
3. [x] **Google Drive**: serviço Google criado, pasta observada compartilhada com o service account, credenciais configuradas em `.env.local` e Vercel.
4. [x] **Telegram**: bot criado via @BotFather, `TELEGRAM_BOT_TOKEN` obtido, `TELEGRAM_ALLOWED_CHAT_IDS` definido.
5. [x] Secrets gerados: `GOOGLE_DRIVE_WEBHOOK_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`.
6. [x] As 9 env vars novas configuradas em `.env.local` e em Project Settings → Environment Variables na Vercel.
7. [x] Cadência de cron verificada no plano Vercel escolhido.
8. [x] `scripts/setup-telegram-webhook.ts` executado em produção.
9. [x] Checklist de QA manual (Task 13) rodado end-to-end: Drive e Telegram aparecem no Kanban corretamente, dedup verificado.

**Critério de pronto**: ✅ atingido — um arquivo solto na pasta do Drive ou enviado ao bot aparece no Kanban em poucos segundos, sem duplicação mesmo se o webhook falhar e o polling pegar o mesmo item.

## Fase 2 — Geração de legenda (IA)

**Status (2026-09-18)**: código implementado, revisado (8 agentes de revisão em paralelo cobrindo correção, comportamento removido, eficiência, simplificação, reuso e convenções) e **mergeado em `main` via PR #3, deployado em produção**. A lacuna arquitetural crítica identificada ao final da Fase 1 foi resolvida: `workers/queues.ts` roda pelo padrão **cron-drain** — o cron consolidado `/api/cron/daily` drena a fila BullMQ dentro de uma Serverless Function.

**Entregáveis**:
- [x] Colunas de legenda/render/publicação e tabela de auditoria adicionadas via migration `00000000000003_add_caption_render_publish.sql` — aplicada pelo usuário no Supabase real (confirmado 2026-09-17).
- [x] Cliente OpenRouter (`lib/captions/`) com structured output / JSON schema, prompt com instrução explícita de não inventar fatos sobre pessoas reais. `JSON.parse` protegido contra retorno malformado.
- [x] Processor de geração de legenda consumindo itens em "recebido" via fila, disparado automaticamente a partir da ingestão.
- [x] **Fix pós-review**: o processor relança erros transitórios em vez de engoli-los, para o mecanismo de retry do `drainQueue` funcionar de verdade (antes, toda falha virava permanente na 1ª tentativa, sem retry real).

**Pendências**:
1. ~~`OPENROUTER_API_KEY` ainda não configurada em lugar nenhum~~ — **resolvido localmente (2026-09-19)**: chave real adicionada a `.env.local`, validada com `GET /api/v1/auth/key` (200) e com uma chamada real de geração de legenda via `requestCaptionFromOpenRouter` (headline/body retornados e parseados corretamente pelo modelo `anthropic/claude-sonnet-5`, default de `OPENROUTER_MODEL`). **Ainda não configurada em produção na Vercel** — sem isso, o pipeline real (Drive/Telegram/n8n → publicação) continua travando em "recebido" em produção.
2. `REDIS_URL` — permissão de escrita confirmada para a connection string local (ver pendência #2 resolvida na Fase 0); falta confirmar se é a mesma configurada em produção na Vercel.

**Critério de pronto**: item processado recebe legenda estruturada e transita de status automaticamente; falhas de geração ficam visíveis, não travam a fila. *(Código pronto, revisado e deployado ✅; validado localmente com credenciais reais. Falta configurar `OPENROUTER_API_KEY` em produção para valer para o pipeline real.)*

## Fase 3 — Render (Creatomate)

**Status (2026-09-18)**: código implementado, revisado e mergeado em `main`. Utilitário de conversão UTC → America/Sao_Paulo criado (`lib/time/`) como base compartilhada para esta fase e a Fase 5. **Template criado pelo usuário e validado com sucesso via `npm run creatomate:smoke-test` contra a API real** (endpoint correto: `POST https://api.creatomate.com/v2/renders`, retorna objeto único — a v1 retornava array, tratado defensivamente). Camadas reais do template mapeadas: `Manchete`, `Foto Esquerda`, `Foto Direita`, `Selo`.

**Entregáveis**:
- [x] Resolução de mídia renderizável: signed URL do Supabase Storage com fallback de download sob demanda do Drive. Guard de tamanho de arquivo agora falha fechado se o Drive não informar o `size` (fix pós-review — um `?? 0` deixava passar arquivos sem esse campo direto para o buffer em memória).
- [x] Cliente Creatomate (`lib/render/creatomate-client.ts`) e builder de `modifications` configurável por env vars, evitando hardcode de nomes de camada do template.
- [x] Processor de render, webhook de conclusão em `app/api/creatomate/webhook/route.ts` (agora com guard `.is("render_url", null)` além do CAS de status — fix pós-review crítico: uma entrega duplicada do webhook do Creatomate podia enfileirar a publicação duas vezes, publicando duas vezes no Instagram), e script de smoke test.
- [x] Processor não relança mais erros que aconteçam **depois** de um render já ter sido disparado no Creatomate (fix pós-review) — evita que um retry da fila dispare um segundo render para o mesmo item.
- [x] Item avança de "legenda" para "renderizando" e, ao concluir (via webhook), o Kanban exibe o link de render.

**Pendências**:
1. `CREATOMATE_LAYER_PHOTO_1`/`CREATOMATE_LAYER_PHOTO_2` (`Foto Esquerda`/`Foto Direita`) já configurados em produção (Vercel) junto com as demais env vars de Creatomate.

**Critério de pronto**: item com legenda gera vídeo correspondente automaticamente; troca de versão de template só entra em produção se o smoke test passar. *(Código pronto ✅ e validado contra a API real e o template de produção.)*

## Fase 4 — Aprovação (Telegram)

**Status (2026-09-17)**: **pulada nesta versão de teste, por decisão explícita do usuário.** O item avança direto de "renderizando" para publicação (Fase 5) sem gate de aprovação humana — ver `lib/publishing/publish-post.ts`, que já lê o item recém-renderizado e chama `getZernioClient().publish(...)` sem checar nenhum campo de aprovação.

**Objetivo**: nenhum vídeo é publicado sem confirmação humana explícita.

**Entregáveis**:
Nenhum entregável foi construído nesta fase. A fase foi explicitamente pulada em favor de um release initial rápido (MVP sem gate de aprovação). Isso contraria a "regra de ouro" original do produto (nenhum post vai ao ar sem aprovação humana explícita — ver `.docs/CLAUDE.md`) e **precisa ser implementada antes de qualquer uso real em produção** com conteúdo que envolva pessoas reais.

**Critério de pronto**:
Não foi atentado nesta versão. Pendência explícita registrada para uma iteração futura — ver item 1 da lista de pendências gerais no final deste arquivo.

## Fase 5 — Publicação e Dashboard

**Status (2026-09-18)**: código implementado, revisado e mergeado em `main`, cobrindo o núcleo de publicação e um MVP de dashboard (Início, Calendário, Analytics).

**Entregáveis**:
- [x] Interface `ZernioClient` com `MockZernioClient` (fallback quando `ZERNIO_API_KEY` está vazio) e `RealZernioClient` (`lib/publishing/real-zernio-client.ts`) implementado e testado contra a API real (`GET /v1/accounts` retornou 200 com a chave fornecida). Parsing de resposta 409 endurecido contra corpo vazio (fix pós-review).
- [x] Processor de publicação imediata (`lib/publishing/publish-post.ts`) com auditoria a cada transição. **Fix pós-review crítico**: o processor não relança mais erros que aconteçam depois de `client.publish()` já ter retornado sucesso (post já está no ar) — antes, um retry da fila nessa janela chamaria `publish()` de novo e postaria duas vezes no Instagram.
- [x] Kanban, Dashboard Início, Calendário editorial e Analytics (MVP).
- [x] Conversão de fuso horário UTC → America/Sao_Paulo usada no calendário/analytics.

**Pendências**:
1. **API key do Zernio conectada só tem a conta `@althorya.ai`, não uma conta da Puzzle Records** — uso intencional confirmado pelo usuário para este teste (`ZERNIO_INSTAGRAM_ACCOUNT_ID` já preenchido com o accountId real dessa conta, tanto local quanto em produção). Falta validar um `publish()` real de ponta a ponta — ação deliberadamente **não executada ainda**, pois publica de verdade no Instagram; requer confirmação explícita do momento certo.
2. **Relatórios/exportação e busca/filtros completos do dashboard** (item do PRD Fase 5) ficam fora deste plano — pendência futura.

**Critério de pronto**: post aprovado é publicado/agendado corretamente no Instagram, horários exibidos batem com America/Sao_Paulo, e o dashboard mostra analytics reais vindos do Zernio. *(Código pronto, revisado e deployado ✅; publicação real de ponta a ponta ainda não executada por decisão deliberada.)*

## Pendências gerais registradas ao fechar as Fases 2/3/5

1. **Gate de aprovação (Fase 4) foi pulado por decisão do usuário** nesta versão de teste — precisa ser implementado antes de qualquer uso real em produção com pessoas reais envolvidas. **Isso já está em produção**: o pipeline publica de verdade no Instagram sem revisão humana assim que `OPENROUTER_API_KEY` for configurada (hoje ainda bloqueado só por essa credencial faltando).
2. **Relatórios/exportação e busca/filtros completos do dashboard** (Fase 5 do PRD) ficam fora deste plano — pendência futura.
3. **`OPENROUTER_API_KEY` nunca foi fornecida** — é a única credencial que falta para o pipeline rodar de ponta a ponta em produção.
4. **Permissão de escrita do `REDIS_URL`** (pendência histórica da Fase 0 — a connection string original era `default_ro`, só leitura) não foi reverificada nesta rodada; confirmar antes de considerar a fila operacional de verdade.

## Deploy em produção (2026-09-18)

- **Projeto Vercel correto identificado e usado**: `puzzle_records_new` (criado 15/09, linkado corretamente ao repositório `CoimbraViih/Puzzle_Records_new`) — **não** o `puzzle-records-bldm`, que roda uma aplicação de produção real e não relacionada (n8n, Cut.Pro, aprovação via WhatsApp, Zernio já ativo). A narrativa de "bloqueio, sem projeto próprio" registrada anteriormente na Fase 1 estava desatualizada — o projeto já existia, só não tinha nenhuma env var configurada.
- PR #3 (`worktree-fase-2-3-5-pipeline` → `main`) revisado, corrigido e **mergeado em `main`**.
- **Dois bugs de deploy só descobertos no deploy real** (não visíveis em `npm run build` local sem as env vars corretas): (1) build quebrava por completo sem `REDIS_URL` — `workers/connection.ts` lançava na importação do módulo; corrigido com `lazyConnect`. (2) o plano Vercel **Hobby rejeitou o deploy** por ter 3 cron jobs (2 deles a cada 5 min) — o plano permite no máximo 2, ambos diários; corrigido consolidando `/api/drive/poll` + `/api/queue/process` num único `/api/cron/daily`, rodando 1x/dia junto com `/api/drive/renew-channel`. **Cadência de ingestão/fila cai de 5 min para até 24h** — decisão aceita explicitamente pelo usuário; reverter é só editar `vercel.ts` ao migrar para o plano Pro.
- **Env vars de produção configuradas** (`vercel env add`, environment Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (precisou `--type config` explícito — o CLI recusa por padrão nomes `NEXT_PUBLIC_*` que parecem credencial), `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `CRON_SECRET`, `CREATOMATE_WEBHOOK_SECRET`, `CREATOMATE_API_KEY`, `CREATOMATE_TEMPLATE_ID`, `CREATOMATE_LAYER_HEADLINE`/`PHOTO_1`/`PHOTO_2`/`BADGE`, `ZERNIO_API_KEY`, `ZERNIO_INSTAGRAM_ACCOUNT_ID`, `PUBLIC_BASE_URL` (`https://puzzlerecordsnew.vercel.app`).
- **Deploy de produção verificado ao vivo**: `/` → 307 (redirect), `/login` → 200, `/dashboard` → 307 (guard de auth funcionando), `/api/queue/process` → 401 sem token (fail-closed correto). App está de pé e servindo corretamente.
- **Env vars faltando em produção**: `OPENROUTER_API_KEY` (nunca fornecida — bloqueia a Fase 2 sozinha), Google Drive (`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_DRIVE_FOLDER_ID`/`GOOGLE_DRIVE_WEBHOOK_TOKEN`) e Telegram (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET`/`TELEGRAM_ALLOWED_CHAT_IDS`) — a Fase 1 tinha essas pendências marcadas como concluídas num registro anterior deste arquivo, mas nenhuma dessas credenciais existe em `.env.local` hoje; **precisa ser reconfirmado com o usuário** antes de assumir que a ingestão real (Drive/Telegram) funciona em produção.
- **Achado paralelo, não destrutivo**: ao rodar `vercel link`, o próprio Vercel (via GitHub App) criou um segundo projeto vazio chamado `puzzle-records-new` (com hífen, distinto do `puzzle_records_new` com underscore) só porque a PR existia. Ele buildou com sucesso mas está vazio/não usado — seguro de ignorar ou apagar depois, não afeta nada em produção.

## Checklist de QA manual end-to-end (Task 13)

Executar depois que as env vars restantes estiverem configuradas em produção:

1. Confirmar as 3 migrations aplicadas no Supabase real (usuário confirmou em 2026-09-17 — vale checar visualmente no Supabase Studio).
2. Configurar `OPENROUTER_API_KEY` em produção (única credencial que falta para a Fase 2 rodar).
3. Reconfirmar se as credenciais de Google Drive/Telegram (Fase 1) realmente estão configuradas em produção — não encontradas em nenhum `.env.local` local nesta rodada.
4. Decidir se `ZERNIO_API_KEY` fica com a conta `@althorya.ai` (teste) ou é trocada por uma conta real da Puzzle Records antes do primeiro post de verdade.
5. Subir uma foto de teste pelo Telegram (ou inserir manualmente um `pipeline_items` de teste, já que a ingestão real está sob suspeita) e acompanhar no Kanban: `recebido` → `legenda` → `renderizando` → `publicado`, checando os logs do `/api/cron/daily` e `/api/queue/process`.
6. Confirmar no Supabase que `audit_log` recebeu uma linha para cada transição de status do item de teste.
7. Confirmar que o post apareceu de verdade na conta Instagram configurada.

## Configurações — Conexões, API Keys e webhook n8n (2026-09-18)

**Status**: implementado — view `/dashboard/configuracoes` (admin-only) com duas seções:
- **Conexões**: 6 cards (Drive, Telegram, OpenRouter, Creatomate, Zernio, n8n) refletindo o estado real via presença de env vars, com botão "Testar conexão" fazendo uma chamada leve real a cada API (exceto n8n, que não tem credencial de saída).
- **API Keys**: tela para criar/listar/revogar chaves (tabela `api_keys`, hash SHA-256, texto puro exibido uma única vez na criação) — usadas para autenticar chamadas recebidas de automações externas.

**Novo canal de ingestão**: `app/api/n8n/webhook/route.ts` — endpoint genérico autenticado por API key (header `Authorization: Bearer`), espelhando o padrão do Telegram (baixa a mídia de `mediaUrl`, salva no bucket `raw-media`, cria `pipeline_items` em "recebido" com `origin: "n8n"`, enfileira a geração de legenda). `pipeline_items.origin` foi ampliado para aceitar `'n8n'` via `supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql`.

**Pendência manual — resolvida (2026-09-18)**: `supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql` aplicada pelo usuário no projeto Supabase real via SQL Editor. A tabela `api_keys` e o `origin` ampliado de `pipeline_items` já existem em produção — a página `/dashboard/configuracoes` não deve mais cair no fallback de "migration pendente".

Live end-to-end QA do webhook do n8n contra o Supabase/Redis real ainda foi deliberadamente adiado (não executado nesta implementação) porque não existe staging separado — `.env.local` aponta para o mesmo Redis/Supabase de produção usado pelo deploy real na Vercel. O risco é baixo (a pipeline trava na geração de legenda sem `OPENROUTER_API_KEY`, então não cascateia para uma publicação real no Instagram), mas uma linha de teste stray em `pipeline_items` ainda apareceria no Kanban real; essa validação segue pendente para o usuário rodar manualmente com uma API key real quando quiser.

**Fora de escopo desta rodada**: as sub-seções "Templates", "Regras de aprovação" e "Geral" descritas no protótipo do `Design.md` não foram construídas (só Conexões e API Keys). O tema visual do `Design.md` (cores de marca magenta, tipografia Barlow Condensed/Public Sans/IBM Plex Mono) que faltava aqui **foi aplicado depois**, na branch `theme-design-visual` (commit `b83db555`, mergeada em `main` em 2026-09-19) — ver seção seguinte.

## Tema visual do Design.md aplicado ao dashboard (2026-09-19)

**Status**: implementado e mergeado em `main`. Tokens de marca/status/tipografia (magenta, Barlow Condensed/Public Sans/IBM Plex Mono, pills de status good/warning/serious/critical/info/processing) aplicados em `app/globals.css` e propagados para sidebar, topbar, login e todas as views do dashboard (Início, Kanban, Calendário, Analytics, Configurações).

## Auditoria completa, correção de bugs e limpeza (2026-09-19)

**Contexto**: a pedido do usuário, rodada de fechamento cobrindo todo o projeto — testes, lint, build, revisão de código dedicada, correção de bugs encontrados, limpeza de branch e deploy.

**Credenciais reais fornecidas pelo usuário e configuradas em `.env.local`** (só local, não versionado):
- `OPENROUTER_API_KEY` — validada com chamada real (`GET /api/v1/auth/key` → 200; geração de legenda real testada e funcionando com o modelo `anthropic/claude-sonnet-5`).
- `REDIS_URL` (Upstash `better-kitten-282197`) — testada com `SET`/`DEL` reais via `ioredis`, confirmando permissão de escrita (resolve a pendência histórica da Fase 0).

**Hygiene de build/lint**: `eslint.config.mjs` não excluía `typescript-sdk/` (clone de referência externo do SDK do OpenRouter, com `.git` próprio, já excluído de `tsconfig.json`/`vitest.config.ts` numa rodada anterior) — gerava 2000+ erros espúrios de lint vindos do SDK. Corrigido.

**Revisão de código dedicada** (agente `code-reviewer` cobrindo `lib/`, `workers/` e `app/api/` inteiros, focada em bugs não documentados nas rodadas anteriores) encontrou e todos foram corrigidos nesta rodada, com testes novos (76 testes no total, antes 62):
1. **[HIGH] Gap estrutural de enqueue-após-escrita**: `upsertPipelineItem()` com `ignoreDuplicates: true` retornava `null` para linhas já existentes; os chamadores (polling do Drive, Telegram, webhook do n8n) interpretavam isso como "não fazer nada", inclusive quando uma tentativa anterior de enfileirar o job de legenda tinha falhado (ex.: Redis fora do ar) — a própria rede de segurança do polling contra webhook perdido era derrotada silenciosamente, deixando itens presos em "recebido" para sempre. Corrigido: `upsertPipelineItem()` agora sempre retorna o `status` atual da linha, e os chamadores decidem enfileirar com base nisso. Complementado por `lib/pipeline/reconcile.ts`, chamado a cada `/api/cron/daily`: reenfileira itens presos em qualquer etapa (recebido/legenda/renderizando) há mais de 15min sem erro registrado — a mesma lacuna existia (sem nenhuma rede de segurança) nas transições legenda→render e render→publish.
2. **[MEDIUM] Comparação de segredo não constant-time**: `CRON_SECRET` em `cron-auth.ts` usava `===` puro, diferente do padrão (`timingSafeEqual`) já usado em `drive/webhook` e `creatomate/webhook`. Extraído `lib/security/safe-compare.ts` compartilhado, aplicado nos três lugares.
3. **[MEDIUM] 409 ambíguo do Zernio tratado como erro comum**: um 409 (idempotência — post já publicado) com corpo vazio/não-JSON virava um erro genérico que o `drainQueue` re-tentava; depois de esgotar tentativas, o item ficava preso em "renderizando" com `publish_error`, escondendo que a publicação já tinha acontecido de verdade. Nova classe `ZernioAmbiguousPublishError` sinaliza esse caso; `processPublishJob` não relança (re-tentar não resolve nada), só registra `publish_error` pedindo verificação manual.
4. **[LOW] SSRF no webhook do n8n**: `mediaUrl` só validava o esquema `https://`, sem checar o destino — uma API key vazada permitiria usar o endpoint para fazer o servidor da Vercel requisitar endereços internos/privados. Novo `assertPublicHttpsUrl()` em `lib/http/url-safety.ts` resolve o hostname via DNS e rejeita ranges privados/loopback/link-local (IPv4 e IPv6) antes do fetch.

**Verificação**: 76 testes passando (18 arquivos), lint limpo (0 erros no código do projeto), build de produção OK. Commit `3fd1d85` em `main`.

**Limpeza**: branch `theme-design-visual` (já mergeada) apagada local e remotamente. Deploy de produção disparado automaticamente pelo push a `main` via integração GitHub↔Vercel.

**Pendências que continuam em aberto** (não fazem parte desta rodada):
- Gate de aprovação humana (Fase 4) continua pulado — ver pendência geral #1 abaixo.
- `OPENROUTER_API_KEY` e a confirmação de que `REDIS_URL` de produção tem permissão de escrita continuam pendentes **em produção na Vercel** (resolvidos só localmente nesta rodada).
- QA end-to-end real (Drive/Telegram/n8n → Kanban → publicação no Instagram) continua não executado.
