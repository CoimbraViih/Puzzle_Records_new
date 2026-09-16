# Milestones — Puzzle Records Social Automation

Cada fase é um incremento entregável e testável isoladamente antes de avançar para a próxima (ver Seção 7 do `PRD.md`). A numeração (Fase 0–5) é a mesma usada em `Skills_Puzzle_Records.md`.

## Fase 0 — Fundação

**Objetivo**: ter um esqueleto de aplicação rodando em produção, com autenticação e permissões, antes de qualquer lógica de pipeline.

**Entregáveis**:
- Scaffold Next.js + TypeScript + Tailwind CSS + shadcn/ui.
- Projeto Supabase configurado: autenticação (login), schema inicial de usuários e papéis (Operador, Aprovador/Editorial, Gestor/Admin).
- Deploy inicial na Vercel (ambiente de staging).
- Estrutura de fila Redis + BullMQ criada (sem jobs reais ainda), pronta para receber os workers das próximas fases.

**Critério de pronto**: usuário consegue logar, ver um dashboard vazio, e o deploy responde em produção. Permissões por papel bloqueiam/liberam telas corretamente.

## Fase 1 — Ingestão

**Objetivo**: material bruto entra no sistema por dois canais e aparece no Kanban como "recebido".

**Entregáveis**:
- Integração com Google Drive API: watch (webhook) na pasta observada + polling de segurança para não perder eventos.
- Bot do Telegram para upload rápido de material bruto.
- Item criado no Kanban no status "recebido" para cada entrada, com metadados de origem (Drive ou Telegram) e autor.

**Critério de pronto**: um arquivo solto na pasta do Drive ou enviado ao bot aparece no Kanban em poucos segundos, sem duplicação mesmo se o webhook falhar e o polling pegar o mesmo item.

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
