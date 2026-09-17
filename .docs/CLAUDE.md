# CLAUDE.md — Puzzle Records Social Automation

Pipeline de automação que transforma material bruto (foto/vídeo + gancho) em um post de Instagram no formato "notícia/fofoca musical" (estilo Choquei/Léo Dias), com legenda gerada por IA, vídeo renderizado por template e aprovação humana obrigatória antes de publicar.

Contexto completo do produto: `.docs/PRD.md`. Roadmap faseado: `.docs/PLAN.md`. Mapa de skills do Claude por etapa do pipeline: `Skills_Puzzle_Records.md`.

## Estado atual

A **Fase 0** (`.docs/PLAN.md`) está implementada e commitada em `main`: scaffold Next.js + Supabase (auth, papéis, RLS) + shell de dashboard + estrutura de fila BullMQ/Redis. Faltam apenas ações manuais fora do código (aplicar a migration no Supabase real, disparar o primeiro deploy na Vercel) — ver checklist em `.docs/PLAN.md`. Próximo passo de implementação: **Fase 1 — Ingestão**.

## Stack

Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, Supabase (auth + Postgres + storage), Node.js, deploy na Vercel. Fila de jobs assíncrona com Redis + BullMQ orquestrando ingestão → legenda → render → aprovação → publicação.

## Regra de ouro

**Nenhum post vai ao ar sem aprovação humana explícita no Telegram.** Qualquer mudança no fluxo de publicação precisa preservar esse gate — o conteúdo envolve fotos e afirmações sobre pessoas reais (ver Seção 8 do PRD).

## Integrações externas e suas particularidades

- **Creatomate** — render de vídeo por template via API assíncrona (aguarda webhook de conclusão, não é síncrono). O template é versionado; nunca trocar a versão em produção sem rodar o smoke test automático primeiro.
- **Zernio** — publicação/agendamento no Instagram e fonte de analytics. Retorna horários em **UTC** — toda a camada de calendário/agendamento/exibição deve converter para `America/Sao_Paulo`. Respeitar a fila de horários e os limites de taxa da própria plataforma.
- **OpenRouter** — geração de legenda/manchete via chat completions com **structured output (JSON schema)**, não texto livre. O prompt deve instruir explicitamente a não inventar fatos sobre pessoas reais.
- **Telegram Bot API** — canal de upload rápido (Fase 1) e canal de aprovação com inline keyboard Aprovar/Editar/Rejeitar (Fase 4), ambos via webhook.
- **Google Drive API** — ingestão do material bruto via watch (webhook) na pasta observada + polling de segurança para não perder eventos se o webhook falhar.
- **Redis + BullMQ** — cada etapa do pipeline é um job de fila; webhooks do Creatomate e do Zernio atualizam o status do item em tempo real no Kanban.

## Convenções

- Server Components por padrão no App Router; usar Client Components só onde há interatividade (Kanban, calendário, inline keyboard de aprovação refletido na UI).
- Acesso a dados e autenticação via Supabase; permissões por papel aplicadas tanto na UI quanto nas policies do Postgres (RLS). Os 3 papéis e seus valores reais no banco (coluna `profiles.role`, texto livre): `equipe_conteudo` (Operador), `editorial` (Aprovador), `admin` (Gestor) — ver `lib/auth/permissions.ts`.
- Toda mudança de status de um item do pipeline deve ser auditável (quem, quando, de onde) — necessário para rastrear aprovações (Seção 8 do PRD).
- Seguir a ordem das fases em `.docs/PLAN.md`: não implementar publicação (Fase 5) antes do gate de aprovação (Fase 4) existir.
