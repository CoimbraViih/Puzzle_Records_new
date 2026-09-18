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

**Objetivo**: cada item recebido ganha automaticamente uma legenda/manchete gerada por IA.

**Entregáveis**:
- Integração com OpenRouter (chat completions com structured output / JSON schema).
- Prompt com instrução explícita de não inventar fatos sobre pessoas reais.
- Job de fila que consome itens em "recebido", gera a legenda e avança o item para o status "legenda".

**Critério de pronto**: item processado recebe legenda estruturada (manchete + texto) e transita de status automaticamente; falhas de geração ficam visíveis (não travam a fila).

## Fase 3 — Render (Creatomate)

**Objetivo**: gerar o vídeo final a partir do template visual do Creatomate.

**Entregáveis**:
- Template desenhado no editor visual do Creatomate seguindo a linguagem de design de referência (manchete, foto dupla, selo "AGORA/IMPACTO", card de perfil do Instagram).
- Integração via API assíncrona do Creatomate + webhook de conclusão do render.
- Versionamento do template com smoke test automático antes de qualquer troca de template em produção.
- Item avança de "legenda" para "renderizando" e, ao concluir, para "vídeo pronto".

**Critério de pronto**: item com legenda gera vídeo correspondente automaticamente; troca de versão de template só entra em produção se o smoke test passar.

## Fase 4 — Aprovação (Telegram)

**Objetivo**: nenhum vídeo é publicado sem confirmação humana explícita.

**Entregáveis**:
- Vídeo pronto é enviado como mensagem no Telegram com inline keyboard: Aprovar / Editar legenda / Rejeitar.
- Registro de quem aprovou/rejeitou e quando (auditoria).
- Alerta de SLA quando um item fica tempo demais em "aguardando aprovação".
- Item avança para "aprovado" (segue para Fase 5) ou volta/encerra em "rejeitado".

**Critério de pronto**: aprovador consegue agir direto pelo Telegram, o Kanban reflete a decisão em tempo real, e o alerta de SLA dispara corretamente em itens parados.

## Fase 5 — Publicação e Dashboard

**Objetivo**: fechar o ciclo com publicação automatizada e visibilidade completa da operação.

**Entregáveis**:
- Integração com Zernio: publicação imediata ou agendada, respeitando fila de horários e limites da plataforma.
- Conversão de fuso horário: Zernio retorna UTC, toda a camada de calendário/agendamento exibe e calcula em America/Sao_Paulo.
- Kanban completo (recebido → legenda → renderizando → aguardando aprovação → agendado → publicado).
- Calendário editorial ligado ao Zernio.
- Analytics (alcance, engajamento, melhores horários) puxados da API do Zernio.
- Relatórios e exportação, busca e filtros no dashboard.

**Critério de pronto**: post aprovado é publicado/agendado corretamente no Instagram, horários exibidos batem com America/Sao_Paulo, e o dashboard mostra analytics reais vindos do Zernio.
