# Skills do Claude/Cowork úteis para o Puzzle Records

Compilação das skills disponíveis nesta conta/sessão que se aplicam ao projeto de automação de redes sociais da Puzzle Records (pipeline: ingestão → legenda por IA → render Creatomate → aprovação Telegram → publicação Zernio → dashboard/analytics). Organizado por etapa do pipeline e por frente de trabalho, não pela ordem alfabética do catálogo — é para ser consultado, não decorado.

Cada linha é `nome-da-skill` — quando usar. Para invocar, use `/nome-da-skill` (ou peça em texto natural — muitas disparam por palavra-chave).

---

## 1. Produção de conteúdo/vídeo (o formato "fofoca musical")

- `hook-writer` — escrever a manchete/gancho de abertura no estilo "AGORA/IMPACTO"; é literalmente o elemento central do template de referência.
- `caption-writer` — legendas de post prontas pro Instagram, complementa (ou serve de fallback humano para) a geração via OpenRouter.
- `carousel-writer` — se o formato expandir para carrossel além de vídeo.
- `ugc-and-influencer` — linguagem e estética de conteúdo estilo UGC/fofoca, relevante pro tom do formato de referência.
- `vox-style-ad-creator` — copy/vídeo com tom de "voz de anúncio/impacto", pode informar variações do template.
- `video-assembly` — montagem/edição de vídeo (útil para preparar o material bruto antes de virar template no Creatomate).
- `ai-video` — geração/edição de vídeo com IA, para variações ou material de apoio além do render por template.
- `captions-and-clipping` / `embedded-captions` — legendas embutidas no vídeo (diferente da legenda do post — é o texto que aparece sobre a imagem).
- `whisper-transcribe` — transcrever áudio de material bruto (entrevistas, bastidores) antes de gerar a legenda com IA.
- `general-video`, `faceless-explainer` — formatos de vídeo complementares, caso surjam variações do produto.
- `ai-voiceover`, `ai-music-and-sound` — narração e trilha, se o template evoluir para vídeo com áudio original.
- `animate`, `animation-vocabulary`, `improve-animations`, `find-animation-opportunities` — vocabulário e revisão de animação, útil ao refinar o template no editor do Creatomate.
- `comfyui-video-pipeline`, `comfyui-video-production`, `comfyui-prompt-engineer` — pipeline ComfyUI, caso parte da produção de imagem/vídeo rode fora do Creatomate.
- `capcut`, `descript`, `heygen` — integrações com ferramentas de edição externas, se entrarem no fluxo de pré-produção.

## 2. Legenda gerada por IA (OpenRouter) — qualidade e tom

- `copywriting` — copy geral, referência de estrutura para o prompt de geração de legenda.
- `copy-editing` — revisão do texto antes de aprovar (útil como checklist manual no passo de aprovação no Telegram).
- `humanizer` — deixar o texto gerado por IA soar menos "robótico", importante para o tom coloquial de fofoca.
- `senior-prompt-engineer`, `prompt-optimizer`, `prompt-library` — desenhar e melhorar o prompt que vai para a API do OpenRouter (inclui a instrução de não inventar fatos sobre pessoas reais, citada no PRD).

## 3. Instagram, publicação e growth (Zernio)

- `instagram-growth` — estratégia de crescimento de conta no Instagram.
- `instagram-seo` — otimização de descoberta (hashtags, alt text, palavras-chave no perfil/posts).
- `profile-optimization` — otimização do perfil da conta conectada ao Zernio.
- `social-strategy` — estratégia de conteúdo social de forma mais ampla.
- `small-business:social-content-engine` — motor de produção de conteúdo social recorrente, próximo do que o pipeline da Puzzle Records automatiza.
- `small-business:content-strategy`, `small-business:marketing-monday` — planejamento e cadência editorial (alimenta o calendário do dashboard).
- `marketing:content-creation`, `marketing:draft-content`, `marketing:campaign-plan`, `marketing:performance-report` — apoio de marketing mais genérico, útil para campanhas específicas (lançamento de música, evento).

## 4. Aprovação e checagem editorial (loop no Telegram)

- `copy-editing` (repetida da seção 2) — dobra como checklist de revisão antes do aprovador clicar em "Aprovar".
- Nenhuma skill do catálogo cobre "checagem de veracidade sobre pessoas reais" diretamente — isso continua sendo processo humano, como já sinalizado no PRD (Seção 8, risco jurídico).

## 5. Dashboard e analytics

- `analytics`, `analytics-and-reporting` — leitura e interpretação dos dados vindos do Zernio (alcance, engajamento, melhores horários).
- `attribution` — se precisar ligar performance de post a resultado de negócio (streams, shows, vendas).
- `goals-and-kpis` — definir as métricas de sucesso do dashboard (Seção 10 do PRD já aponta essa necessidade).
- `dataviz` — **carregar antes de desenhar qualquer gráfico/tela do dashboard** (paleta, forma dos gráficos, KPI tiles).
- `data:build-dashboard`, `data:create-viz`, `data:data-visualization`, `data:analyze`, `data:explore-data` — construção efetiva das telas de analytics.
- `small-business:report-builder`, `small-business:report-pack`, `small-business:growth-pulse` — relatórios periódicos automatizados a partir dos dados do pipeline.

## 6. Marca, design do template e identidade visual

- `brand`, `brandkit`, `brand-guidelines`, `brand-profile`, `small-business:brand-style` — consolidar a identidade visual da Puzzle Records (cores, tipografia, tom) antes de travar o template no Creatomate.
- `design:design-critique`, `design:design-system`, `design:ux-copy` — revisão crítica do template e da UI do dashboard.
- `banner-design` — peças estáticas complementares ao vídeo.
- `canva`, `small-business:canva-creator`, `canva:edit-design`, `canva:get-design-feedback`, `canva:brand-check`, `canva:resize-for-social-media`, `canva:bulk-create` — se parte da produção de imagem estática (ex.: stories de apoio) passar pelo Canva em vez do Creatomate.

## 7. Pesquisa de concorrência e público

- `competitor-analysis`, `competitors`, `competitor-profiling`, `product-management:competitive-brief` — mapear outras páginas de fofoca musical (Choquei, Léo Dias e afins) para benchmarking de formato e cadência.
- `audience-research`, `customer-research`, `market-sizing-research` — entender o público que consome esse tipo de conteúdo.

## 8. Planejamento técnico e execução do SaaS

- `writing-plans` — **já usada** para gerar o PRD/plano de desenvolvimento faseado.
- `executing-plans`, `subagent-driven-development` — executar cada fase do roadmap (Fase 0 a Fase 5 do PRD) tarefa por tarefa.
- `engineering:architecture`, `engineering:system-design` — desenho técnico detalhado de cada subsistema (ingestão, fila, webhooks).
- `engineering:code-review`, `engineering:testing-strategy`, `engineering:debug`, `engineering:tech-debt` — qualidade de código ao longo da implementação.
- `engineering:deploy-checklist` — checklist antes de colocar cada fase em produção.
- `product-management:write-spec`, `product-management:sprint-planning`, `product-management:roadmap-update` — desdobrar o roadmap faseado em specs e sprints menores.
- `workflow-automation`, `n8n-agents`, `n8n-workflow-patterns`, `n8n-code-javascript`, `n8n-mcp-tools-expert` — caso parte da orquestração (fila, webhooks, integrações) seja implementada em n8n em vez de código customizado — há um servidor n8n conectado nesta sessão.

## 9. Automação de operação (se a Puzzle Records virar um cliente recorrente da Hunter.ai)

- `small-business:build-agent` — transformar tarefas manuais do time editorial em skills reutilizáveis com gatilho por nome ou agenda.
- `small-business:build-connector` — conectar uma ferramenta que ainda não tem MCP oficial (útil se surgir algum sistema interno da Puzzle Records sem integração pronta).
- `small-business:crm-autopilot` — se precisarem gerenciar relacionamento com artistas/fontes de fofoca como um funil.

---

## Como usar este documento

1. Não é para rodar todas de uma vez — é um mapa de qual skill puxar em cada etapa do pipeline descrito no PRD (`2026-09-15-puzzle-records-social-automation-prd.md`).
2. Ao começar cada fase do roadmap (Seção 9 do PRD), volte aqui e confira a seção correspondente antes de pedir para o Claude executar.
3. Esta lista reflete o catálogo de skills disponível nesta conta em 2026-09-15 — pode mudar com o tempo; vale reconferir a listagem de skills disponíveis antes de assumir que uma delas ainda existe com esse nome.
