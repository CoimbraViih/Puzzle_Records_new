# Fase 0 — Fechamento (QA + Deploy) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fechar a Fase 0 do Puzzle Records — o scaffold (Next.js + Supabase + permissões + shell de dashboard + estrutura BullMQ) já está implementado no repositório; falta validar tudo localmente com o checklist de QA e colocar a aplicação no ar em produção na Vercel, atendendo ao critério de pronto do `.docs/PLAN.md`.

**Architecture:** Nenhuma mudança de arquitetura. A Fase 0 já entregou: Next.js App Router com Server Components por padrão, Supabase Auth (`@supabase/ssr`) com `proxy.ts` (equivalente ao middleware — Next.js 16 renomeou `middleware.ts` para `proxy.ts`, ver `node_modules/next/dist/docs/01-app/02-guides/proxy.md`) fazendo refresh de sessão e checagem de papel via `lib/auth/permissions.ts`, papéis em `public.profiles` (`equipe_conteudo`, `editorial`, `admin` — valores reais do projeto Supabase reaproveitado, não um enum inventado), e `/workers` isolado com conexão BullMQ/Upstash sem jobs reais. O que falta é puramente operacional: confirmar que o comportamento é o esperado ponta a ponta e publicar.

**Tech Stack:** (inalterado) Next.js 16 (App Router) + TypeScript, Tailwind CSS v4, shadcn/ui, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), BullMQ + ioredis, Vitest, Vercel, Upstash Redis.

**Estado verificado antes de escrever este plano:**
- Todas as Tasks 1–12 do plano anterior (`docs/plans/2026-09-15-fase-0-fundacao.md`) já estão commitadas (`git log` confere item a item, incluindo o fix de rename `middleware.ts` → `proxy.ts` e o fix de segurança do header `x-user-role`).
- `npm run test` passa: 1 arquivo, 6 testes (`lib/auth/permissions.test.ts`).
- `.env.local` já existe localmente (não versionado).
- Repositório remoto conectado: `https://github.com/CoimbraViih/Puzzle_Records_new.git`, branch `main`.
- **Nenhum deploy na Vercel foi feito ainda** — isso é o item que falta para o critério de pronto ("o deploy responde em produção").
- A CLI da Vercel não está instalada nesta máquina (`npm i -g vercel` recomendado, mas o deploy também pode ser feito 100% pelo dashboard web, que é o caminho usado abaixo para não exigir instalação global).

**Pré-requisitos que o humano precisa confirmar antes de começar:**
- `public.profiles` **já existe em produção** (reaproveitado de uma versão anterior do produto, com RLS e papéis próprios — `equipe_conteudo`/`editorial`/`admin`) e **não deve ser recriado**. Confirme apenas que a migration `supabase/migrations/00000000000001_add_audit_log.sql` (só cria `audit_log`) já foi aplicada (tabela `audit_log` visível no Supabase Studio). Se ainda não foi aplicada, a Task 1 cobre isso.
- Acesso ao time Vercel: `https://vercel.com/viihcoimbra7x-9058s-projects`.
- Uma connection string Redis (Upstash) válida (`rediss://...`), a mesma usada em `.env.local` ou uma nova para o ambiente hospedado.
- Pelo menos um usuário de teste criado no Supabase Auth para rodar o checklist de QA (login real).

---

## Task 1: Confirmar a migration do Supabase no projeto real

**Files:** nenhum arquivo novo — verificação/aplicação no Supabase Studio.

**Importante:** `public.profiles` **já existe em produção**, reaproveitado de uma versão anterior do produto (RLS e papéis próprios, coluna `role` texto livre com valores `equipe_conteudo`/`editorial`/`admin` — ver `lib/auth/permissions.ts`). **Não recrie `profiles` nem aplique a antiga migration `00000000000001_init_profiles_and_audit.sql`** — esse arquivo foi removido do repositório justamente porque nunca chegou a ser aplicada e recriaria `profiles`/um enum incompatíveis com os dados reais já existentes. A única migration válida desta fase é `supabase/migrations/00000000000001_add_audit_log.sql`, que cria apenas `audit_log`.

**Step 1: Verificar se `audit_log` já existe**

No Supabase Studio do projeto (Table Editor), confirme se `public.profiles` já existe (deve existir — não crie) e se `public.audit_log` existe com RLS habilitada (ícone de cadeado).

**Step 2: Se `audit_log` não existir, aplicar a migration**

Copie o conteúdo de `supabase/migrations/00000000000001_add_audit_log.sql` e execute no SQL Editor do Supabase Studio (ou, se a CLI do Supabase estiver instalada e linkada: `npx supabase db push`).

Expected: tabela `audit_log` criada, policies visíveis em Authentication → Policies. `profiles` permanece inalterada.

**Step 3: Confirmar que existe pelo menos um usuário `admin`**

O usuário real do projeto (`victor-coimbra@hotmail.com`) já está com `role = 'admin'`. Para um usuário de teste adicional, promova-o:

```sql
update public.profiles set role = 'admin' where email = 'seu-email@exemplo.com';
```

Expected: `select role from public.profiles where email = 'seu-email@exemplo.com';` retorna `admin`.

Sem commit nesta task (mudança é só no banco).

---

## Task 2: QA manual local completo

**Files:** nenhum arquivo novo — apenas execução e observação.

**Step 1: Subir o servidor de desenvolvimento**

Run: `npm run dev`
Expected: servidor sobe em `http://localhost:3000` sem erros no terminal.

**Step 2: Rodar o checklist de comportamento, na ordem**

1. Acessar `http://localhost:3000` deslogado → deve redirecionar para `/login`.
2. Acessar `http://localhost:3000/dashboard` deslogado → deve redirecionar para `/login`.
3. Logar com o usuário `admin` (já existente em produção, `victor-coimbra@hotmail.com`, ou o de teste da Task 1) → deve redirecionar para `/dashboard` mostrando "Nenhum item no pipeline ainda", com sidebar mostrando todos os itens (Início, Kanban, Aprovações, Configurações).
4. Rodar `update public.profiles set role = 'equipe_conteudo' where email = '...'` no SQL Editor, deslogar (botão "Sair") e logar de novo → sidebar mostra só "Início" e "Kanban".
5. Com esse mesmo usuário `equipe_conteudo`, tentar acessar `http://localhost:3000/dashboard/aprovacoes` direto pela URL → deve redirecionar de volta para `/dashboard` (bloqueio de rota funcionando, não só ocultação visual).
6. Rodar `update public.profiles set role = 'editorial' where email = '...'`, deslogar e logar de novo → sidebar mostra "Aprovações" também, e a rota `/dashboard/aprovacoes` fica acessível (mesmo que a página ainda não exista de verdade — isso será implementado na Fase 4).
7. Voltar o papel para `admin` e confirmar acesso a `/dashboard/configuracoes`.
8. Clicar em "Sair" → volta para `/login`, e `/dashboard` volta a redirecionar para `/login`.

Expected: todos os 8 passos se comportam exatamente como descrito. Se algum falhar, pare e trate como bug antes de prosseguir (não é esperado, já que a lógica tem testes unitários e review de segurança feitos, mas QA manual existe para pegar o que os testes não cobrem).

**Step 3: Rodar a suíte de testes automatizados**

Run: `npm run test`
Expected: `Test Files 1 passed (1)`, `Tests 6 passed (6)`.

**Step 4: Rodar o build de produção**

Run: `npm run build`
Expected: build completa sem erros de tipo ou lint. Preste atenção especial a warnings sobre `proxy.ts`/Edge runtime, já que é uma API relativamente nova do Next.js 16.

**Step 5: Rodar o build localmente em modo produção (opcional mas recomendado)**

Run: `npm run start` (após o build) e repetir os passos 1–8 do Step 2 contra `http://localhost:3000` em modo produção, não só em `next dev`.

Sem commit nesta task — é só verificação. Se qualquer ajuste de código for necessário para corrigir um item do checklist, trate como uma correção pontual com seu próprio commit (`fix: ...`) antes de seguir para o deploy.

---

## Task 3: Configurar o projeto na Vercel

**Files:** nenhum arquivo novo — configuração via dashboard da Vercel.

**Step 1: Garantir que o `main` está atualizado no GitHub**

Run:
```bash
git status
git push origin main
```

Expected: `git status` limpo (working tree clean) e nada novo para enviar (ou o push completa sem conflito).

**Step 2: Importar o repositório na Vercel**

No dashboard `https://vercel.com/viihcoimbra7x-9058s-projects`: **Add New → Project → Import Git Repository** → selecionar `CoimbraViih/Puzzle_Records_new`. O preset "Next.js" deve ser detectado automaticamente (Next.js 16 é reconhecido nativamente).

**Step 3: Configurar as variáveis de ambiente do projeto**

Em Project Settings → Environment Variables, adicionar (nos ambientes "Production" e "Preview"):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`

Use os mesmos valores de `.env.local` (ou equivalentes de produção, se o usuário preferir separar ambientes de Supabase/Redis).

**Step 4: Disparar o primeiro deploy**

Clique em "Deploy" na tela de importação. Expected: build finaliza com sucesso (mesmo comando `npm run build` validado na Task 2) e a Vercel expõe uma URL pública (algo como `https://puzzle-records-new.vercel.app`).

Sem commit de código nesta task.

---

## Task 4: QA na URL pública de produção/staging

**Files:** nenhum arquivo novo.

**Step 1: Repetir o checklist da Task 2 (Step 2) contra a URL pública da Vercel**

Login com os três papéis (`equipe_conteudo`, `editorial`, `admin`), bloqueio/liberação de rota, e logout — tudo contra a URL de produção, não `localhost`.

Expected: comportamento idêntico ao ambiente local.

**Step 2: Verificar os logs de build/runtime na Vercel**

No dashboard do projeto → aba "Deployments" → abrir o deployment atual → conferir que não há erros nos logs de build nem de function/runtime ao navegar pela aplicação.

**Step 3: Se algo divergir do local (ex.: variável de ambiente faltando, erro de cookie em produção), corrigir e reimplantar**

Qualquer ajuste de código vai como commit próprio (`fix: ...`) seguido de `git push origin main`, que dispara redeploy automático na Vercel.

---

## Task 5: Fechar a Fase 0

**Files:**
- Modify: `.docs/CLAUDE.md` (seção "Estado atual")

**Step 1: Atualizar a seção "Estado atual" do CLAUDE.md**

Trocar o parágrafo que hoje diz que o repositório "ainda não tem git init nem scaffold" e que o próximo passo é a Fase 0, para refletir que a Fase 0 está concluída e o próximo passo é a Fase 1 (Ingestão):

```markdown
## Estado atual

Fase 0 (Fundação) concluída: scaffold Next.js + Supabase (auth + papéis) + dashboard shell + estrutura de fila Redis/BullMQ, com deploy em produção na Vercel. Próximo passo de implementação é a **Fase 1** em `.docs/PLAN.md` (ingestão via Google Drive + Telegram).
```

**Step 2: Commit**

```bash
git add .docs/CLAUDE.md
git commit -m "docs: mark Fase 0 as complete, point to Fase 1"
git push origin main
```

---

## Critério de pronto (definition of done da Fase 0)

- [x] Scaffold Next.js + TypeScript + Tailwind + shadcn/ui.
- [x] Projeto Supabase com autenticação e papéis (`equipe_conteudo`, `editorial`, `admin`).
- [x] Estrutura `/workers` com BullMQ + Upstash Redis conectando (sem jobs reais).
- [ ] Migration `add_audit_log` aplicada no projeto Supabase real (`profiles` já existe e não é recriada) e usuário `admin` de teste confirmado (Task 1).
- [ ] QA manual local completo, testes unitários e build de produção passando (Task 2).
- [ ] Deploy respondendo em produção na Vercel (Task 3).
- [ ] Permissões por papel validadas na URL pública, não só localmente (Task 4).
- [ ] `.docs/CLAUDE.md` atualizado apontando para a Fase 1 (Task 5).
