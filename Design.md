# Design.md — Puzzle Records Ops (dashboard)

Documento de referência de design para o projeto **Puzzle Records** (automação de redes sociais), para ser usado dentro do projeto no Claude Code ao construir a interface real. Descreve o protótipo funcional publicado como artifact — `Puzzle Records Ops` — que é **apenas front-end/design**: nenhuma integração real, todo o estado vive em memória JS (`state`), nada é persistido, nada chama API externa. Serve como especificação visual e de interação, não como código para copiar 1:1 (o protótipo é HTML/CSS/JS vanilla single-file; a implementação real provavelmente será outro stack).

Artifact publicado: `Puzzle Records Ops` (link disponível na conversa/galeria de artifacts do Claude).

---

## 1. Por que esse visual

O acento de marca é magenta (`#D6249F` no claro / `#F0479F` no escuro) — deliberadamente **fora** das quatro cores de status (verde/âmbar/laranja/vermelho), para nunca colidir semanticamente com um indicador de estado. A referência visual (a página estilo "Choquei" anexada no início do projeto) informou o tom editorial/tablóide do *conteúdo mockado* (legendas, ganchos, nomes de artistas fictícios) — não o visual do dashboard em si, que é um painel operacional B2B convencional, não uma peça de mídia social.

Tipografia: `Barlow Condensed` (600/700) para títulos/hero numbers, `Public Sans` (400–700) para corpo/UI, `IBM Plex Mono` (400/500) para relógio, IDs e números tabulares. As três vêm do Google Fonts (único host de stylesheet permitido pelo Artifact tool).

## 2. Tokens de cor

Todos os tokens são CSS custom properties em `:root` (claro, padrão), redefinidos em `@media (prefers-color-scheme: dark)` sob `:root:not([data-theme="light"])` e de novo em `:root[data-theme="dark"]` — os três estados de tema exigidos pelo Artifact tool.

### Marca e superfícies

| Token | Claro | Escuro |
|---|---|---|
| `--accent` | `#D6249F` | `#F0479F` |
| `--accent-ink` | `#ffffff` | `#1A0A14` |
| `--accent-soft` | `#FCE4F5` | `#3A1230` |
| `--page` | `#F4F2F6` | `#0D0B10` |
| `--surface` | `#FBFAFC` | `#17141C` |
| `--surface-raised` | `#FFFFFF` | `#1D1922` |
| `--border` | `rgba(20,14,24,.10)` | `rgba(255,255,255,.09)` |
| `--border-strong` | `rgba(20,14,24,.16)` | `rgba(255,255,255,.16)` |
| `--text-1` | `#14121A` | `#F6F4F8` |
| `--text-2` | `#55506B` | `#C7C2D1` |
| `--text-muted` | `#8A8598` | `#8E899C` |

### Status (fixo — mesma regra da skill `dataviz`: nunca reaproveitado para "série 4", sempre ícone + rótulo)

| Papel | Claro | Escuro | Uso |
|---|---|---|---|
| `--good` | `#0ca30c` | `#2fbf5a` | publicado, conectado, sucesso |
| `--warning` | `#c9860a` | `#f0a93b` | aguardando aprovação, atenção |
| `--serious` | `#ec835a` | `#ec835a` | alerta intermediário |
| `--critical` | `#d03b3b` | `#e66767` | falhou, rejeitado, erro |
| `--info` | `#2a78d6` | `#3987e5` | agendado, informativo |
| `--processing` | `#6C3CE9` | `#9C8CF2` | gerando legenda, renderizando |

Cada status tem também uma variante `-bg` (tint de fundo do pill) — `--good-bg`, `--warning-bg`, `--serious-bg`, `--critical-bg`, `--info-bg`, `--processing-bg`, mais `--neutral-bg` para o estado "recebido"/sem status.

### Gráficos (herdados da paleta validada da skill `dataviz`, não inventados)

- `--series-1` = azul categórico slot 1 (`#2a78d6` claro / `#3987e5` escuro) — linha de alcance no Analytics.
- Rampa sequencial de azul `--seq-100…600` — usada no heatmap de "melhores horários" (magnitude = mais escuro = mais engajamento).

### Tipografia

- `--font-display`: `"Barlow Condensed", system-ui, sans-serif`
- `--font-body`: `"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif`
- `--font-mono`: `"IBM Plex Mono", ui-monospace, "SFMono-Regular", monospace`

## 3. Estrutura de navegação (6 views)

Shell fixo: sidebar à esquerda (nav + badge "Ambiente de teste — nada conectado" pulsante) + topbar (relógio ao vivo em `America/Sao_Paulo`, botão "Novo post de teste") + área de conteúdo com `<section class="view">` uma por tela, alternadas via `goto(view)` que faz toggle de `[hidden]` — nunca `display`, conforme contrato do Artifact.

Abaixo de 860px a sidebar vira painel off-canvas (menu hambúrguer), grid de cards colapsa para 1 coluna.

1. **Painel** (`#view-painel`) — visão geral: 4 stat tiles com sparkline SVG inline, funil das 7 etapas do pipeline, feed de atividade recente, resumo de status das 6 integrações.
2. **Pipeline** (`#view-pipeline`) — Kanban com as 7 colunas do PRD: `recebido → legenda → renderizando → aprovação → agendado → publicado → falhou`. Cada card tem thumbnail (gradiente CSS placeholder), artista, gancho/manchete, tempo relativo. Botão de reset/repopular dados mock.
3. **Aprovações** (`#view-aprovacoes`) — fila de itens em `aprovacao` com botões Aprovar / Editar / Rejeitar, mais histórico auditável (tabela) de decisões já tomadas.
4. **Calendário** (`#view-calendario`) — grid mensal, navegação mês anterior/próximo, clique no dia abre painel de detalhe, chips coloridos por status (`info`=agendado, `good`=publicado, `critical`=falhou).
5. **Analytics** (`#view-analytics`) — pensado para "conectar no Zernio": toggle de conectado/desconectado (`#zernio-switch`) demonstrando os dois estados. Conectado: 4 stat tiles, gráfico de linha/área desenhado à mão em SVG (alcance 14 dias, crosshair + tooltip no hover, toggle "ver tabela" para acessibilidade), heatmap de melhores horários (rampa sequencial azul), lista de top posts em barras proporcionais. Desconectado: empty state (`#analytics-empty`) linkando de volta para Configurações → Conexões.
6. **Configurações** (`#view-config`) — layout com sub-nav interna (`setConfigPane`):
   - **Conexões**: 6 cards de integração (Google Drive, Telegram, Instagram/Facebook, Creatomate, OpenRouter, Zernio), cada um com ícone de marca, toggle conectar/desconectar (só altera `state.connections` local) e formulário expansível com campos mock relevantes — ex.: Telegram tem "Enviar mensagem de teste", Creatomate tem "Rodar smoke test".
   - **Templates**: tabela mock de templates do Creatomate (status ativo/arquivado/rascunho, timestamp do último smoke test).
   - **Regras de aprovação**: seletor de SLA + tabela mock de aprovadores.
   - **Geral**: fuso horário, idioma, campos de workspace.

## 4. Fluxo central: assistente "Novo post de teste"

O botão de inserção de post pedido explicitamente pelo usuário. Abre um modal com wizard de 5 passos (`STEP_LABELS = ["Origem","Processando","Revisão","Aprovação","Publicado"]`), visualizando o pipeline completo ponta a ponta descrito no PRD:

1. **Origem** — escolha Google Drive vs. Telegram como entrada, dropzone mock, campos de artista/gancho.
2. **Processando** — animação sequencial de 4 passos encadeados via `setTimeout` (fila → render Creatomate → legenda por IA → pronto), simulando o tempo real de processamento assíncrono.
3. **Revisão** — placeholder de vídeo + textarea editável com a legenda gerada pela IA (mock).
4. **Aprovação** — bolha de chat estilo Telegram fake, com botões inline Aprovar / Editar / Rejeitar funcionando de verdade (mutam o estado local); fluxo de "editar legenda" embutido.
5. **Publicado** — tela de confirmação (sucesso ou rejeição).

Ao concluir, o item entra de verdade em `state.pipeline`, `state.approvalHistory` e, se aprovado, em `state.calendar.posts` — Kanban, fila de aprovações, painel e calendário são todos re-renderizados na hora. É a prova visual de que o layout aguenta o ciclo de vida completo de um post, mesmo sem nenhuma chamada de API real.

## 5. Componentes (inventário)

Seguindo a hierarquia Tier 0/1/2 da skill `dataviz`, mais os componentes de produto específicos deste dashboard:

- **Stat tile** (`.stat-tile`) — valor + delta + sparkline SVG opcional. Usado no Painel e no Analytics.
- **Pill de status** (`.pill` + tons `.good/.warning/.serious/.critical/.info/.processing/.neutral`) — sempre ícone SVG inline + rótulo de texto, nunca cor isolada (regra da `dataviz`).
- **Kanban card** (`.kcard`) — thumbnail em gradiente, nome do artista, gancho, timestamp relativo, pill de etapa.
- **Célula de calendário** (`.cal-day`) — dia do mês + até N chips de post, estado selecionado destacado.
- **Card de integração** (`.integration-card`) — ícone de marca, nome, descrição, toggle, formulário expansível de configuração.
- **Wizard modal** (`.modal` + `.modal-steps`) — indicador de progresso de 5 passos, conteúdo por etapa trocado dinamicamente.
- **Bolha de chat Telegram mock** (`.tg-wrap`/`.tg-bubble`/`.tg-kb`) — simula o layout real de teclado inline do Telegram para dar noção de produto final ao time.
- **Gráfico de linha com hover** (`renderLineChart`) — SVG desenhado à mão, crosshair + tooltip no `mousemove`, toggle de tabela equivalente (par de acessibilidade exigido pela `dataviz`).
- **Heatmap** (`renderHeatmap`) — células na rampa sequencial azul `--seq-100…600`.
- **Empty state** (`.empty-state`) — usado quando Zernio está "desconectado" no Analytics.
- **Dropzone** (`.dropzone`) — área de upload mock no passo 1 do wizard.

## 6. Estados de interação a preservar na implementação real

- **Conectado / desconectado** por integração — cada uma das 6 integrações tem estado independente; a tela de Analytics depende do estado do Zernio especificamente para decidir entre dado populado e empty state.
- **Processando** (`--processing`, roxo) é visualmente distinto de **aguardando ação humana** (`--warning`, âmbar) — importante porque o PRD identifica a tensão velocidade-automática vs. aprovação-humana como risco #1; a UI já separa esses dois conceitos por cor.
- **Vazio vs. erro vs. sucesso** — nunca reaproveitar a mesma cor de status para dois significados diferentes (regra fixa da `dataviz`: paleta de status nunca é tematizável nem reciclável).

## 7. O que este documento e o protótipo NÃO cobrem

- Nenhuma chamada real a Google Drive, Telegram, Creatomate, OpenRouter, Instagram/Facebook ou Zernio — todo dado é mock, gerado em `seedData()` a partir de arrays fictícios (`ARTISTS`, `HOOKS`, `CAPTIONS`), deliberadamente com nomes/conteúdo fictícios pelo risco jurídico de imagem/difamação já sinalizado no PRD (Seção 8).
- Sem autenticação, sem persistência entre sessões (estado vive só em memória JS do navegador — um refresh da página reseta tudo).
- Sem responsividade testada em todos os breakpoints além do ponto de quebra em 860px verificado no protótipo.
- Não define microcópia final de erro/validação para os formulários de configuração — os campos mock não têm validação real.
- Cores e componentes aqui documentados são o ponto de partida; qualquer decisão de marca definitiva (ex.: trocar o magenta de acento) deve ser validada de novo pelo script `validate_palette.js` da skill `dataviz` antes de entrar em produção.
