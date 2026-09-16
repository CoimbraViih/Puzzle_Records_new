# PRD: Puzzle Records — Social Automation

## 1. Contexto e Problema

A Puzzle Records precisa publicar conteúdo em vídeo no Instagram no formato de "página de notícia/fofoca musical" (estilo Choquei/Léo Dias: manchete de impacto, foto dupla, selo "AGORA/IMPACTO"). Hoje esse processo é manual: alguém edita o vídeo à mão, escreve a legenda, decide o horário e posta — e o formato só funciona se for rápido, porque vive de furo e atualidade.

Isso gera três problemas: (1) o tempo entre "temos o gancho" e "o vídeo está no ar" é longo demais para um formato que depende de velocidade; (2) a produção não escala sem contratar mais gente para editar vídeo e escrever legenda; (3) não há visibilidade de calendário nem de analytics para saber o que está performando e ajustar a operação.

## 2. Solução Proposta

O produto é um pipeline de automação ponta a ponta para o formato de vídeo de notícia/fofoca musical da Puzzle Records:

1. O material bruto entra pelo Google Drive (pasta observada por webhook + polling de segurança) ou por upload rápido no bot do Telegram.
2. Uma IA via OpenRouter gera a legenda/manchete automaticamente a partir do contexto enviado, em formato estruturado (JSON schema).
3. O Creatomate renderiza o vídeo final preenchendo, via API, um template que o próprio time desenha no editor visual do Creatomate (estilo do print de referência: manchete, foto dupla, selo de impacto).
4. O vídeo pronto volta como mensagem no Telegram com botões Aprovar / Editar / Rejeitar, para um humano confirmar antes de qualquer publicação.
5. Uma vez aprovado, o Zernio publica ou agenda o post no Instagram, respeitando fila de horários e os limites da própria plataforma.
6. Um dashboard mostra o pipeline em Kanban (recebido → legenda → renderizando → aguardando aprovação → agendado → publicado), um calendário editorial ligado ao Zernio e analytics (alcance, engajamento, melhores horários) puxados da API do Zernio.

O ganho central é reduzir o tempo entre "temos o gancho" e "o vídeo está no ar", mantendo sempre aprovação humana antes de publicar, já que o conteúdo envolve fotos e afirmações sobre pessoas reais.

## 3. Requisitos Funcionais

- Login e Autenticação
- Kanban
- Dashboards
- Multi usuário
- Permissões por usuário
- Calendário
- Notificações
- Relatórios e Exportação
- Integrações (API)
- Upload de Arquivos
- Busca e Filtros

Pipeline assíncrono orientado a fila (jobs de ingestão, geração de legenda, renderização e publicação), com webhooks de conclusão do Creatomate e do Zernio atualizando o status em tempo real.

Aprovação via bot do Telegram (inline keyboard: Aprovar / Editar legenda / Rejeitar), com registro de quem aprovou e alerta de SLA se um item ficar tempo demais aguardando aprovação.

Versionamento do template do Creatomate com smoke test automático antes de trocar o template em produção.

Conversão de fuso horário: o Zernio retorna horários em UTC; toda a camada de calendário/agendamento precisa exibir e calcular em America/Sao_Paulo.

## 4. Personas

**Operador de Conteúdo** — Sobe o material bruto (Drive ou Telegram) e acompanha o item no Kanban até a publicação.

**Aprovador/Editorial** — Recebe o vídeo pronto no Telegram, confere a legenda gerada pela IA (inclusive checagem de veracidade, já que envolve pessoas reais), aprova, edita ou rejeita antes de qualquer post ir ao ar.

**Gestor/Admin** — Acompanha o dashboard, o calendário editorial e os analytics (alcance, engajamento, melhores horários), gerencia qual template do Creatomate está ativo em produção e audita quem aprovou cada post.

## 5. Stack Técnico

- Next.js
- React
- Tailwind CSS
- shadcn/ui
- Supabase
- Vercel
- Claude Code
- Node.js
- PostgreSQL
- TypeScript

Integrações externas específicas do produto: Creatomate (render de vídeo por template via API assíncrona com webhook), Zernio (publicação/agendamento/fila de horários e analytics do Instagram), OpenRouter (LLM para gerar legenda/manchete via chat completions com structured output), Telegram Bot API (bot de aprovação com inline keyboard e webhook), Google Drive API (ingestão do material bruto via watch + polling de segurança). Fila de jobs: Redis + BullMQ para orquestrar ingestão → legenda → render → aprovação → publicação de forma assíncrona.

## 6. Linguagem de Design

Formato "Choquei" / Léo Dias — página de notícia/fofoca musical: manchete de impacto em destaque, composição de duas fotos lado a lado, selo "IMPACTO"/"AGORA" sobreposto, card de perfil do Instagram (posts/seguidores/seguindo) sobreposto à imagem, tipografia bold, alto contraste, formato vertical 9:16 pensado para Reels/Stories. É a referência do template que será construído no editor do Creatomate.

Para o dashboard interno (Kanban, calendário, analytics): referência tipo Linear/Notion — interface limpa, hierarquia visual clara entre os status do pipeline, sem excesso de elementos, já que quem usa é a própria equipe operacional, não um cliente final.

## 7. Processo

- Quebrar a construção do app em milestones lógicos (etapas) — ver `PLAN.md`.
- Cada milestone deve ser um incremento entregável.
- Priorizar funcionalidade core primeiro, depois iterar.
- Testar cada milestone antes de avançar para o próximo.

## 8. Riscos e Considerações Legais

- **Afirmações sobre pessoas reais**: o conteúdo é fofoca musical envolvendo pessoas reais. A IA gera a legenda/manchete, mas não há checagem automática de veracidade — isso continua sendo processo humano no passo de aprovação (ver Persona "Aprovador/Editorial"). O prompt de geração de legenda deve instruir explicitamente a IA a não inventar fatos.
- **Aprovação humana obrigatória**: nenhum post é publicado sem confirmação explícita de um humano no Telegram (Aprovar/Editar/Rejeitar). Essa é a principal mitigação de risco jurídico e reputacional do produto.
- **Uso de imagens de terceiros**: o material bruto (fotos usadas na composição dupla do template) deve ter sua origem e direito de uso verificados pelo Operador de Conteúdo antes de subir ao pipeline; o sistema não valida isso automaticamente.
- **Auditoria**: todo post publicado deve manter registro de quem aprovou e quando, para rastreabilidade em caso de reclamação ou correção.

## 9. Roadmap Faseado (Fase 0 a Fase 5)

Detalhamento completo em `PLAN.md`. Resumo:

- **Fase 0 — Fundação**: scaffold do projeto, autenticação/permissões, deploy inicial.
- **Fase 1 — Ingestão**: entrada de material bruto via Google Drive e Telegram.
- **Fase 2 — Geração de legenda (IA)**: integração com OpenRouter.
- **Fase 3 — Render (Creatomate)**: template e renderização via API.
- **Fase 4 — Aprovação (Telegram)**: fluxo de aprovação humana.
- **Fase 5 — Publicação e Dashboard**: integração Zernio, Kanban, calendário e analytics.

## 10. Métricas de Sucesso (KPIs)

- **Tempo gancho → publicado**: tempo decorrido entre o material bruto entrar no pipeline e o post ir ao ar (métrica central do produto — é o problema que ele resolve).
- **Throughput**: número de posts produzidos por semana sem aumento de headcount.
- **SLA de aprovação**: tempo médio e máximo que um item fica parado em "aguardando aprovação" (alerta configurado quando excede o limite).
- **Taxa de rejeição**: proporção de legendas/vídeos rejeitados pelo Aprovador antes de publicar (indica qualidade da geração automática).
- **Alcance e engajamento**: puxados da API do Zernio, usados para identificar melhores horários e formatos de maior performance.
