# Configurações — Conexões, API Keys e Webhook n8n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a view `/dashboard/configuracoes` (admin-only, já roteada em `lib/auth/permissions.ts` e linkada na sidebar, mas sem página) com duas seções — Conexões (status + teste de conectividade das integrações externas já existentes, mais um card do n8n) e API Keys (criar/listar/revogar chaves usadas para autenticar chamadas recebidas) — e deixar um endpoint de webhook genérico pronto para o n8n usar essas chaves para inserir itens no pipeline como um 3º canal de ingestão, ao lado de Drive e Telegram.

**Architecture:** Segue exatamente os padrões já estabelecidos no repositório: `lib/<domínio>/*.ts` para lógica pura testável + `getServiceRoleClient()` para acesso a dados fora de sessão de usuário, webhook de ingestão em `app/api/n8n/webhook/route.ts` espelhando `app/api/telegram/webhook/route.ts` (download de mídia → upload no bucket `raw-media` → `upsertPipelineItem` → enfileira `captionQueue` → `triggerQueueDrain()`), e a UI nova usa Server Actions (`"use server"`) chamadas por pequenos Client Components, sem introduzir nenhuma biblioteca de state management. A autenticação do webhook do n8n é por API key própria (tabela nova `api_keys`, hash SHA-256 armazenado, texto puro mostrado uma única vez na criação) — não reaproveita o padrão de secret único via env var usado pelos outros webhooks, porque o pedido explícito é uma tela para *criar* chaves.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), TypeScript, Supabase (Postgres + Storage + RLS), Vitest, shadcn/ui (`Card`, `Button`, `Input`, `Label`) já instalados no projeto.

**Spec:** `.docs/CLAUDE.md`, `.docs/PLAN.md` (Fases 0–5 já implementadas — este plano é um incremento sobre a Fase 5, não uma fase nova do PRD), `Design.md` (protótipo visual de referência — ver nota de escopo abaixo).

## Global Constraints

- **Regra de ouro do produto** (`.docs/CLAUDE.md`): nenhuma mudança aqui altera o fluxo de publicação nem o gate de aprovação (que já está pulado por decisão prévia do usuário, fora de escopo deste plano).
- **Fail-closed em autenticação**: seguir o padrão de `requireEnv()` (`lib/ingestion/cron-auth.ts`) e `verifyApiKey()` (novo, Task 2) — ausência/erro de credencial nunca deve liberar acesso.
- **Nunca logar segredos em texto puro** — mesma regra já aplicada ao token do Telegram em `lib/ingestion/telegram.ts`.
- **Toda mudança de status de um item do pipeline é auditável** (`lib/audit/log-system-event.ts`) — o webhook do n8n não muda status (só cria em "recebido", igual Drive/Telegram, que também não auditam a criação), então nada novo a auditar aqui além do já existente.
- **Decisão de escopo visual**: `Design.md` descreve um protótipo com tema magenta/Barlow Condensed e uma sub-nav de 4 painéis em Configurações (Conexões, Templates, Regras de aprovação, Geral). O dashboard real hoje (`app/dashboard/*`) usa Tailwind + shadcn neutro, sem nenhum desses tokens de marca. Este plano constrói **apenas** a seção Conexões (6 cards: Drive, Telegram, OpenRouter, Creatomate, Zernio, n8n — substituindo o card "Instagram/Facebook" do protótipo, que neste código não existe como credencial própria: a publicação no Instagram é só via Zernio) e a seção API Keys, no mesmo estilo visual neutro já usado no resto do dashboard, para manter consistência com o código existente. Templates/Regras de aprovação/Geral **ficam fora deste plano** — registrar como pendência futura se o usuário quiser aplicar o tema visual completo do `Design.md` a todo o app depois.
- **Sem alteração de schema fora do necessário**: a migration só adiciona `api_keys` e amplia o `check` de `pipeline_items.origin` — não mexe em `profiles` (reaproveitado, não recriável, ver `.docs/PLAN.md`).

---

### Task 1: Migration — tabela `api_keys` + `pipeline_items.origin` aceita `'n8n'`

**Files:**
- Create: `supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql`

**Interfaces:**
- Produces: tabela `public.api_keys(id uuid pk, name text, key_hash text unique, key_prefix text, created_by uuid, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)`, reaproveitando a função `public.audit_log_viewer_is_admin()` já criada na migration 1 para as policies de RLS. `pipeline_items.origin` passa a aceitar `'drive' | 'telegram' | 'n8n'`.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql
--
-- Duas mudanças relacionadas a uma tela nova de Configurações (Conexões +
-- API Keys) e a um novo canal de ingestão via n8n:
--
-- 1) api_keys: chaves que autenticam chamadas RECEBIDAS de sistemas
--    externos (hoje só o webhook do n8n). Nunca guardamos o texto puro —
--    só o hash SHA-256 (key_hash) e um prefixo curto (key_prefix) para o
--    usuário reconhecer a chave numa lista sem poder recuperar o valor
--    completo. Reaproveita a função public.audit_log_viewer_is_admin(),
--    criada na migration 00000000000001, para restringir leitura/escrita a
--    admins — mesmo padrão já usado ali.
--
-- 2) pipeline_items.origin: amplia o check constraint para aceitar 'n8n'
--    como um 3º canal de ingestão, ao lado de 'drive' e 'telegram'.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_key_hash_idx on public.api_keys (key_hash);

alter table public.api_keys enable row level security;

create policy "admins can read api_keys"
  on public.api_keys for select
  using (public.audit_log_viewer_is_admin());

-- Sem policy de insert/update para "authenticated": a criação e revogação
-- de chaves passam por Server Actions que usam o client de service role
-- (mesmo padrão de pipeline_items — só service_role grava, bypassando RLS).
-- A policy de select acima só existe para permitir leitura direta futura via
-- client autenticado, se um dia a UI deixar de usar service role para isso.

grant select on public.api_keys to authenticated;

-- pipeline_items.origin: amplia para aceitar 'n8n'. O nome do constraint é
-- o autogerado pelo Postgres para um `check` inline declarado na migration
-- 00000000000002 (padrão "<tabela>_<coluna>_check").
alter table public.pipeline_items drop constraint pipeline_items_origin_check;
alter table public.pipeline_items
  add constraint pipeline_items_origin_check check (origin in ('drive', 'telegram', 'n8n'));
```

- [ ] **Step 2: Registrar a pendência manual de aplicação**

Esta migration segue o mesmo padrão das anteriores (00000000000001–3): o código assume que ela foi colada manualmente no SQL Editor do Supabase Studio do projeto real. Adicionar ao final da Task 8 (atualização do `.docs/PLAN.md`) a pendência "aplicar `00000000000004_add_api_keys_and_n8n_origin.sql` em produção" — não é possível automatizar isso sem a connection string direta do Postgres (mesma limitação já documentada nas fases anteriores).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql
git commit -m "feat(db): adiciona tabela api_keys e amplia pipeline_items.origin para n8n"
```

---

### Task 2: `lib/api-keys/api-keys.ts` — geração, hash, criação, listagem, revogação e verificação

**Files:**
- Create: `lib/api-keys/api-keys.ts`
- Test: `lib/api-keys/api-keys.test.ts`

**Interfaces:**
- Consumes: `getServiceRoleClient()` de `@/lib/supabase/service-role`.
- Produces (usado pelas Tasks 4, 6, 7):
  - `generateApiKey(): { plaintext: string; hash: string; prefix: string }`
  - `hashApiKey(plaintext: string): string`
  - `ApiKeyRow { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }`
  - `createApiKey(input: { name: string; createdBy: string | null }): Promise<{ row: ApiKeyRow; plaintext: string }>`
  - `listApiKeys(): Promise<ApiKeyRow[]>`
  - `revokeApiKey(id: string): Promise<void>`
  - `verifyApiKey(plaintext: string): Promise<{ id: string; name: string } | null>`

- [ ] **Step 1: Escrever os testes das funções puras (sem banco)**

```typescript
// lib/api-keys/api-keys.test.ts
import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "./api-keys";

describe("generateApiKey", () => {
  it("gera uma chave com o prefixo pzr_ e um hash SHA-256 consistente", () => {
    const generated = generateApiKey();

    expect(generated.plaintext.startsWith("pzr_")).toBe(true);
    expect(generated.hash).toHaveLength(64); // sha256 em hex
    expect(generated.hash).toBe(hashApiKey(generated.plaintext));
    expect(generated.prefix).toBe(generated.plaintext.slice(0, 10));
  });

  it("gera chaves diferentes a cada chamada", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("hashApiKey", () => {
  it("é determinístico para a mesma entrada", () => {
    expect(hashApiKey("pzr_abc")).toBe(hashApiKey("pzr_abc"));
  });

  it("produz hashes diferentes para entradas diferentes", () => {
    expect(hashApiKey("pzr_abc")).not.toBe(hashApiKey("pzr_abd"));
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham (módulo não existe ainda)**

Run: `npm test -- lib/api-keys/api-keys.test.ts`
Expected: FAIL com "Cannot find module './api-keys'"

- [ ] **Step 3: Implementar `lib/api-keys/api-keys.ts`**

```typescript
// lib/api-keys/api-keys.ts
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

const KEY_PREFIX = "pzr_";
// Tamanho do prefixo exibido na UI para o usuário reconhecer a chave numa
// lista (ex.: "pzr_AbCdEf") sem nunca guardar/exibir o valor completo de novo.
const DISPLAY_PREFIX_LENGTH = 10;

export interface GeneratedApiKey {
  plaintext: string;
  hash: string;
  prefix: string;
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}${random}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const API_KEY_COLUMNS = "id, name, key_prefix, created_at, last_used_at, revoked_at";

/**
 * Cria uma nova API key. O texto puro (`plaintext`) só existe neste retorno —
 * não é persistido em lugar nenhum, e o chamador (Server Action da UI) deve
 * exibi-lo ao usuário uma única vez, avisando que não pode ser recuperado depois.
 */
export async function createApiKey(input: { name: string; createdBy: string | null }): Promise<{
  row: ApiKeyRow;
  plaintext: string;
}> {
  const generated = generateApiKey();
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      name: input.name,
      key_hash: generated.hash,
      key_prefix: generated.prefix,
      created_by: input.createdBy,
    })
    .select(API_KEY_COLUMNS)
    .single();

  if (error) throw error;
  return { row: data as ApiKeyRow, plaintext: generated.plaintext };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select(API_KEY_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ApiKeyRow[];
}

export async function revokeApiKey(id: string): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);

  if (error) throw error;
}

/**
 * Verifica uma chave recebida em texto puro (ex.: header Authorization de um
 * webhook externo) contra o hash salvo. Fail-closed: qualquer erro de banco,
 * chave sem o prefixo esperado, inexistente ou revogada retorna null — nunca
 * lança para o chamador tratar como "autorizado" por engano.
 */
export async function verifyApiKey(plaintext: string): Promise<{ id: string; name: string } | null> {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(plaintext);
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_hash, revoked_at")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Comparação constant-time redundante com o filtro exato acima, mas mantida
  // como defesa em profundidade (mesmo padrão de app/api/creatomate/webhook).
  const stored = Buffer.from(data.key_hash);
  const provided = Buffer.from(hash);
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) return null;

  try {
    const { error: touchError } = await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    if (touchError) console.error("[api-keys] falha ao atualizar last_used_at:", touchError);
  } catch (touchError) {
    console.error("[api-keys] falha ao atualizar last_used_at:", touchError);
  }

  return { id: data.id, name: data.name };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- lib/api-keys/api-keys.test.ts`
Expected: PASS (2 describe blocks, 4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/api-keys/api-keys.ts lib/api-keys/api-keys.test.ts
git commit -m "feat: adiciona geração, hash, criação, listagem, revogação e verificação de API keys"
```

---

### Task 3: Ampliar `PipelineItemOrigin` para incluir `"n8n"` e corrigir o label no Kanban/Início

**Files:**
- Modify: `lib/ingestion/pipeline-items.ts:3`
- Modify: `app/dashboard/kanban/page.tsx:33`
- Test: `lib/ingestion/pipeline-items.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `PipelineItemOrigin = "drive" | "telegram" | "n8n"` (usado pela Task 4 ao chamar `upsertPipelineItem({ origin: "n8n", ... })`).

- [ ] **Step 1: Escrever o teste do novo caso `n8n` em `buildPipelineItemPayload`**

Adicionar ao final de `lib/ingestion/pipeline-items.test.ts` (mantendo os dois testes existentes de `drive` e `telegram` intactos):

```typescript
  it("monta o payload de um item vindo do n8n", () => {
    const payload = buildPipelineItemPayload({
      origin: "n8n",
      externalId: "n8n-run-42",
      title: "Gancho vindo do n8n",
      author: "workflow: captação-automatica",
      mimeType: "image/jpeg",
      storagePath: "n8n/n8n-run-42.jpg",
      metadata: { apiKeyId: "11111111-1111-1111-1111-111111111111" },
    });

    expect(payload.origin).toBe("n8n");
    expect(payload.storage_path).toBe("n8n/n8n-run-42.jpg");
    expect(payload.drive_file_id).toBeNull();
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (tipo não aceita "n8n")**

Run: `npm test -- lib/ingestion/pipeline-items.test.ts`
Expected: FAIL — erro de tipo do TypeScript (`origin: "n8n"` não é atribuível a `PipelineItemOrigin`)

- [ ] **Step 3: Ampliar o tipo em `lib/ingestion/pipeline-items.ts`**

Em `lib/ingestion/pipeline-items.ts:3`, trocar:

```typescript
export type PipelineItemOrigin = "drive" | "telegram";
```

por:

```typescript
export type PipelineItemOrigin = "drive" | "telegram" | "n8n";
```

- [ ] **Step 4: Corrigir o label de origem no Kanban**

Em `app/dashboard/kanban/page.tsx:33`, trocar:

```tsx
{item.origin === "drive" ? "Drive" : "Telegram"} · {item.author ?? "autor desconhecido"}
```

por:

```tsx
{ORIGIN_LABELS[item.origin] ?? item.origin} · {item.author ?? "autor desconhecido"}
```

E adicionar, logo abaixo de `STATUS_LABELS` no topo do arquivo:

```typescript
const ORIGIN_LABELS: Record<string, string> = {
  drive: "Drive",
  telegram: "Telegram",
  n8n: "n8n",
};
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npm test -- lib/ingestion/pipeline-items.test.ts`
Expected: PASS (3 testes)

Run: `npm run build`
Expected: build passa sem erros de tipo (confirma que `app/dashboard/kanban/page.tsx` compila com o `origin` ampliado)

- [ ] **Step 6: Commit**

```bash
git add lib/ingestion/pipeline-items.ts lib/ingestion/pipeline-items.test.ts app/dashboard/kanban/page.tsx
git commit -m "feat: amplia PipelineItemOrigin para incluir n8n e corrige label no Kanban"
```

---

### Task 4: Webhook de ingestão do n8n — `app/api/n8n/webhook/route.ts`

**Files:**
- Create: `app/api/n8n/webhook/route.ts`
- Test: `app/api/n8n/webhook/route.test.ts`

**Interfaces:**
- Consumes: `verifyApiKey` de `@/lib/api-keys/api-keys` (Task 2), `isHttpsUrl` de `@/lib/http/url-safety`, `upsertPipelineItem` de `@/lib/ingestion/pipeline-items` (Task 3), `getServiceRoleClient` de `@/lib/supabase/service-role`, `captionQueue` de `@/workers/queues`, `triggerQueueDrain` de `@/lib/queue/trigger`.
- Produces: `POST /api/n8n/webhook` — autenticado via header `Authorization: Bearer <api key>`, cria um `pipeline_items` em `"recebido"` com `origin: "n8n"`.

- [ ] **Step 1: Escrever os testes de autenticação e validação**

```typescript
// app/api/n8n/webhook/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyApiKey = vi.fn();
const upsertPipelineItem = vi.fn();
const captionQueueAdd = vi.fn();
const triggerQueueDrain = vi.fn();
const storageUpload = vi.fn();

vi.mock("@/lib/api-keys/api-keys", () => ({ verifyApiKey }));
vi.mock("@/lib/ingestion/pipeline-items", () => ({ upsertPipelineItem }));
vi.mock("@/workers/queues", () => ({ captionQueue: { add: captionQueueAdd } }));
vi.mock("@/lib/queue/trigger", () => ({ triggerQueueDrain }));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    storage: { from: () => ({ upload: storageUpload }) },
  }),
}));

// Evita bater na rede de verdade nos testes que nem deveriam chegar ao fetch
// (as pastas de auth/validação abaixo retornam antes disso).
global.fetch = vi.fn();

import { POST } from "./route";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/n8n/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/n8n/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem header Authorization", async () => {
    const response = await POST(makeRequest({ externalId: "x", mediaUrl: "https://x.com/a.jpg" }));
    expect(response.status).toBe(401);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("retorna 401 quando a API key é inválida ou revogada", async () => {
    verifyApiKey.mockResolvedValue(null);
    const response = await POST(
      makeRequest({ externalId: "x", mediaUrl: "https://x.com/a.jpg" }, { authorization: "Bearer pzr_invalida" }),
    );
    expect(response.status).toBe(401);
  });

  it("retorna 400 quando externalId ou mediaUrl estão ausentes", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    const response = await POST(makeRequest({ externalId: "x" }, { authorization: "Bearer pzr_valida" }));
    expect(response.status).toBe(400);
  });

  it("retorna 400 quando mediaUrl não é https", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    const response = await POST(
      makeRequest({ externalId: "x", mediaUrl: "http://inseguro.com/a.jpg" }, { authorization: "Bearer pzr_valida" }),
    );
    expect(response.status).toBe(400);
  });

  it("cria o pipeline_item e enfileira a legenda quando tudo é válido", async () => {
    verifyApiKey.mockResolvedValue({ id: "key-1", name: "n8n prod" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "10" }),
      arrayBuffer: async () => new ArrayBuffer(10),
    });
    storageUpload.mockResolvedValue({ error: null });
    upsertPipelineItem.mockResolvedValue({ id: "item-1", external_id: "x" });

    const response = await POST(
      makeRequest(
        { externalId: "x", mediaUrl: "https://cdn.n8n.io/a.jpg", mimeType: "image/jpeg", title: "Gancho", author: "fluxo-x" },
        { authorization: "Bearer pzr_valida" },
      ),
    );

    expect(response.status).toBe(200);
    expect(upsertPipelineItem).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "n8n", externalId: "x", storagePath: "n8n/x.jpg" }),
    );
    expect(captionQueueAdd).toHaveBeenCalledWith("caption", { pipelineItemId: "item-1" });
    expect(triggerQueueDrain).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham (rota não existe ainda)**

Run: `npm test -- app/api/n8n/webhook/route.test.ts`
Expected: FAIL com "Cannot find module './route'"

- [ ] **Step 3: Implementar `app/api/n8n/webhook/route.ts`**

```typescript
// app/api/n8n/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys/api-keys";
import { isHttpsUrl } from "@/lib/http/url-safety";
import { upsertPipelineItem } from "@/lib/ingestion/pipeline-items";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";

export const dynamic = "force-dynamic";

// Teto de tamanho para o download da mídia apontada por mediaUrl (mesmo
// limite usado em lib/render/media.ts para o download do Drive).
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

interface N8nWebhookPayload {
  externalId?: string;
  title?: string | null;
  author?: string | null;
  mediaUrl?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

function extractBearerToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("video")) return "mp4";
  if (mimeType.startsWith("image")) return "jpg";
  return "bin";
}

/**
 * Endpoint genérico de ingestão para o n8n (ou qualquer automação externa
 * autenticada com uma API key criada em /dashboard/configuracoes): recebe
 * uma URL de mídia https, baixa o arquivo, salva no bucket raw-media e cria
 * um pipeline_item em "recebido" — o mesmo formato de entrada usado por
 * Drive e Telegram (ver lib/ingestion/telegram.ts para o padrão espelhado).
 *
 * Autenticação por API key própria (tabela api_keys), não por secret fixo
 * via env var como os outros webhooks: aqui o objetivo é permitir múltiplas
 * automações externas, cada uma com sua própria chave revogável.
 */
export async function POST(request: NextRequest) {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "missing Authorization Bearer token" }, { status: 401 });
  }

  const apiKey = await verifyApiKey(token);
  if (!apiKey) {
    return NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as N8nWebhookPayload | null;
  if (!payload?.externalId || !payload.mediaUrl) {
    return NextResponse.json({ error: "externalId e mediaUrl são obrigatórios" }, { status: 400 });
  }

  if (!isHttpsUrl(payload.mediaUrl)) {
    return NextResponse.json({ error: "mediaUrl precisa ser uma URL https" }, { status: 400 });
  }

  let fileBytes: Uint8Array;
  try {
    const mediaResponse = await fetch(payload.mediaUrl);
    if (!mediaResponse.ok) {
      throw new Error(`download da mídia falhou com status ${mediaResponse.status}`);
    }
    const contentLength = mediaResponse.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_MEDIA_BYTES) {
      throw new Error(`mídia declara ${contentLength} bytes, acima do limite de ${MAX_MEDIA_BYTES} bytes`);
    }
    const buffer = await mediaResponse.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      throw new Error(`mídia tem ${buffer.byteLength} bytes, acima do limite de ${MAX_MEDIA_BYTES} bytes`);
    }
    fileBytes = new Uint8Array(buffer);
  } catch (error) {
    console.error("[n8n/webhook] falha ao baixar mediaUrl:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "não foi possível baixar mediaUrl" }, { status: 400 });
  }

  const mimeType = payload.mimeType ?? "application/octet-stream";
  const storagePath = `n8n/${payload.externalId}.${extensionFor(mimeType)}`;

  const supabase = getServiceRoleClient();
  const { error: uploadError } = await supabase.storage
    .from("raw-media")
    .upload(storagePath, fileBytes, { contentType: mimeType, upsert: false });
  // upsert: false + 409 (already exists) é esperado em reentrega do n8n —
  // mesmo tratamento do webhook do Telegram.
  if (uploadError && uploadError.status !== 409 && uploadError.statusCode !== "409") {
    console.error("[n8n/webhook] falha ao subir mídia para o Supabase Storage:", uploadError);
    return NextResponse.json({ error: "falha ao salvar mídia" }, { status: 500 });
  }

  const result = await upsertPipelineItem({
    origin: "n8n",
    externalId: payload.externalId,
    title: payload.title ?? null,
    author: payload.author ?? null,
    mimeType,
    storagePath,
    metadata: { ...payload.metadata, apiKeyId: apiKey.id, apiKeyName: apiKey.name },
  });

  if (result) {
    await captionQueue.add("caption", { pipelineItemId: result.id });
    triggerQueueDrain();
  }

  return NextResponse.json({ ok: true, pipelineItemId: result?.id ?? null });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- app/api/n8n/webhook/route.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add app/api/n8n/webhook/route.ts app/api/n8n/webhook/route.test.ts
git commit -m "feat: adiciona webhook de ingestao do n8n autenticado por API key"
```

---

### Task 5: `lib/connections/status.ts` — status de configuração e teste de conectividade das integrações

**Files:**
- Create: `lib/connections/status.ts`
- Test: `lib/connections/status.test.ts`

**Interfaces:**
- Consumes: `requireEnv`/env vars diretamente, `listApiKeys` de `@/lib/api-keys/api-keys` (Task 2).
- Produces (usado pela Task 6):
  - `type IntegrationKey = "drive" | "telegram" | "openrouter" | "creatomate" | "zernio" | "n8n"`
  - `getConnectionStatus(key: IntegrationKey): Promise<"connected" | "not_configured">`
  - `testConnection(key: Exclude<IntegrationKey, "n8n">): Promise<{ ok: boolean; message: string }>`

- [ ] **Step 1: Escrever os testes da parte pura (checagem de env vars) e da matriz de integrações sem-teste**

```typescript
// lib/connections/status.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api-keys/api-keys", () => ({ listApiKeys: vi.fn() }));

import { listApiKeys } from "@/lib/api-keys/api-keys";
import { getConnectionStatus } from "./status";

const ORIGINAL_ENV = { ...process.env };

describe("getConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("retorna not_configured quando falta alguma env var do Drive", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    expect(await getConnectionStatus("drive")).toBe("not_configured");
  });

  it("retorna connected quando todas as env vars do Drive existem", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "svc@example.com";
    process.env.GOOGLE_PRIVATE_KEY = "chave";
    process.env.GOOGLE_DRIVE_FOLDER_ID = "folder-1";
    expect(await getConnectionStatus("drive")).toBe("connected");
  });

  it("retorna connected para n8n quando existe ao menos 1 API key não revogada", async () => {
    vi.mocked(listApiKeys).mockResolvedValue([
      { id: "1", name: "n8n", key_prefix: "pzr_ab", created_at: "now", last_used_at: null, revoked_at: null },
    ]);
    expect(await getConnectionStatus("n8n")).toBe("connected");
  });

  it("retorna not_configured para n8n quando todas as chaves estão revogadas", async () => {
    vi.mocked(listApiKeys).mockResolvedValue([
      { id: "1", name: "n8n", key_prefix: "pzr_ab", created_at: "now", last_used_at: null, revoked_at: "now" },
    ]);
    expect(await getConnectionStatus("n8n")).toBe("not_configured");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- lib/connections/status.test.ts`
Expected: FAIL com "Cannot find module './status'"

- [ ] **Step 3: Implementar `lib/connections/status.ts`**

```typescript
// lib/connections/status.ts
import { listApiKeys } from "@/lib/api-keys/api-keys";

export type IntegrationKey = "drive" | "telegram" | "openrouter" | "creatomate" | "zernio" | "n8n";
export type ConnectionStatus = "connected" | "not_configured";

function hasAllEnv(names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]));
}

const ENV_REQUIREMENTS: Record<Exclude<IntegrationKey, "n8n">, string[]> = {
  drive: ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_DRIVE_FOLDER_ID"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_CHAT_IDS"],
  openrouter: ["OPENROUTER_API_KEY"],
  creatomate: ["CREATOMATE_API_KEY", "CREATOMATE_TEMPLATE_ID"],
  zernio: ["ZERNIO_API_KEY", "ZERNIO_INSTAGRAM_ACCOUNT_ID"],
};

/**
 * n8n não tem credencial de saída (env var) — o Puzzle Records é quem expõe
 * o webhook para o n8n chamar. "Conectado" aqui significa "existe pelo menos
 * uma API key ativa para autenticar essa chamada", não uma checagem de rede.
 */
export async function getConnectionStatus(key: IntegrationKey): Promise<ConnectionStatus> {
  if (key === "n8n") {
    const keys = await listApiKeys();
    return keys.some((k) => !k.revoked_at) ? "connected" : "not_configured";
  }
  return hasAllEnv(ENV_REQUIREMENTS[key]) ? "connected" : "not_configured";
}

export type TestableIntegrationKey = Exclude<IntegrationKey, "n8n">;

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

async function testDrive(): Promise<ConnectionTestResult> {
  const { getDriveClient } = await import("@/lib/ingestion/google-drive");
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) return { ok: false, message: "GOOGLE_DRIVE_FOLDER_ID não configurado." };
  const drive = getDriveClient();
  const response = await drive.files.get({ fileId: folderId, fields: "id, name", supportsAllDrives: true });
  return { ok: true, message: `Pasta encontrada: ${response.data.name ?? response.data.id}` };
}

async function testTelegram(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const { Bot } = await import("grammy");
  const bot = new Bot(requireEnv("TELEGRAM_BOT_TOKEN"));
  const me = await bot.api.getMe();
  return { ok: true, message: `Bot conectado: @${me.username}` };
}

async function testOpenRouter(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}` },
  });
  if (!response.ok) return { ok: false, message: `OpenRouter respondeu ${response.status}` };
  return { ok: true, message: "Chave válida no OpenRouter." };
}

async function testCreatomate(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const templateId = requireEnv("CREATOMATE_TEMPLATE_ID");
  const response = await fetch(`https://api.creatomate.com/v2/templates/${templateId}`, {
    headers: { Authorization: `Bearer ${requireEnv("CREATOMATE_API_KEY")}` },
  });
  if (!response.ok) return { ok: false, message: `Creatomate respondeu ${response.status}` };
  return { ok: true, message: "Template encontrado no Creatomate." };
}

async function testZernio(): Promise<ConnectionTestResult> {
  const { requireEnv } = await import("@/lib/ingestion/cron-auth");
  const baseUrl = process.env.ZERNIO_API_BASE_URL || "https://zernio.com/api";
  const response = await fetch(`${baseUrl}/v1/accounts`, {
    headers: { Authorization: `Bearer ${requireEnv("ZERNIO_API_KEY")}` },
  });
  if (!response.ok) return { ok: false, message: `Zernio respondeu ${response.status}` };
  return { ok: true, message: "Conta(s) encontrada(s) no Zernio." };
}

const TEST_FUNCTIONS: Record<TestableIntegrationKey, () => Promise<ConnectionTestResult>> = {
  drive: testDrive,
  telegram: testTelegram,
  openrouter: testOpenRouter,
  creatomate: testCreatomate,
  zernio: testZernio,
};

export async function testConnection(key: TestableIntegrationKey): Promise<ConnectionTestResult> {
  try {
    return await TEST_FUNCTIONS[key]();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[connections] teste de conexão falhou para ${key}:`, message);
    return { ok: false, message };
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- lib/connections/status.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/connections/status.ts lib/connections/status.test.ts
git commit -m "feat: adiciona status de configuracao e teste de conectividade das integracoes"
```

---

### Task 6: Server Actions de Configurações — `app/dashboard/configuracoes/actions.ts`

**Files:**
- Create: `app/dashboard/configuracoes/actions.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`, `isUserRole` de `@/lib/auth/permissions`, `createApiKey`/`revokeApiKey` de `@/lib/api-keys/api-keys` (Task 2), `testConnection` de `@/lib/connections/status` (Task 5).
- Produces (usado pela Task 7):
  - `testConnectionAction(key: TestableIntegrationKey): Promise<ConnectionTestResult>`
  - `createApiKeyAction(prevState: unknown, formData: FormData): Promise<{ error: string | null; plaintext: string | null; name: string | null }>`
  - `revokeApiKeyAction(prevState: unknown, formData: FormData): Promise<{ error: string | null }>`

- [ ] **Step 1: Implementar `app/dashboard/configuracoes/actions.ts`**

Não há teste automatizado dedicado para este arquivo: Server Actions do Next.js exigem o runtime do App Router para rodar (usam `next/cache` e o contexto de request), o que não é isolável em Vitest sem reimplementar esse runtime — mesmo padrão já adotado no projeto, onde nenhuma page/action de UI tem teste unitário (só `lib/*` e `app/api/*/route.ts` têm). A verificação real acontece na Task 7 (QA manual da página) e no `npm run build`.

```typescript
// app/dashboard/configuracoes/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUserRole, type UserRole } from "@/lib/auth/permissions";
import { createApiKey, revokeApiKey } from "@/lib/api-keys/api-keys";
import { testConnection, type ConnectionTestResult, type TestableIntegrationKey } from "@/lib/connections/status";

/**
 * Defesa em profundidade: /dashboard/configuracoes já é bloqueada para
 * não-admin em lib/auth/permissions.ts (aplicada no proxy.ts), mas Server
 * Actions podem ser invocadas diretamente (POST ao endpoint da action) sem
 * passar pela navegação de página — então repetimos a checagem de papel
 * aqui, fail-closed, mesmo padrão de app/dashboard/layout.tsx.
 */
async function requireAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("não autenticado");

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (error) throw new Error("falha ao verificar permissão");

  const role: UserRole | undefined = isUserRole(profile?.role) ? profile.role : undefined;
  if (role !== "admin") throw new Error("acesso restrito a administradores");

  return { userId: user.id };
}

export async function testConnectionAction(key: TestableIntegrationKey): Promise<ConnectionTestResult> {
  await requireAdmin();
  return testConnection(key);
}

export interface CreateApiKeyState {
  error: string | null;
  plaintext: string | null;
  name: string | null;
}

export async function createApiKeyAction(_prevState: CreateApiKeyState, formData: FormData): Promise<CreateApiKeyState> {
  const { userId } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Dê um nome para identificar a chave.", plaintext: null, name: null };
  }

  const { plaintext } = await createApiKey({ name, createdBy: userId });
  revalidatePath("/dashboard/configuracoes");
  return { error: null, plaintext, name };
}

export interface RevokeApiKeyState {
  error: string | null;
}

export async function revokeApiKeyAction(_prevState: RevokeApiKeyState, formData: FormData): Promise<RevokeApiKeyState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "id da chave ausente" };

  await revokeApiKey(id);
  revalidatePath("/dashboard/configuracoes");
  return { error: null };
}
```

- [ ] **Step 2: Rodar o typecheck/build**

Run: `npm run build`
Expected: build passa sem erros de tipo

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/configuracoes/actions.ts
git commit -m "feat: adiciona server actions de teste de conexao e gestao de api keys"
```

---

### Task 7: Página `/dashboard/configuracoes` — Conexões + API Keys

**Files:**
- Create: `app/dashboard/configuracoes/page.tsx`
- Create: `app/dashboard/configuracoes/connection-card.tsx`
- Create: `app/dashboard/configuracoes/api-keys-section.tsx`

**Interfaces:**
- Consumes: `getConnectionStatus` de `@/lib/connections/status` (Task 5), `listApiKeys` de `@/lib/api-keys/api-keys` (Task 2), `testConnectionAction`/`createApiKeyAction`/`revokeApiKeyAction` de `./actions` (Task 6), `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`Button`/`Input`/`Label` de `@/components/ui/*`.
- Produces: página renderizada, sem interface consumida por outras tasks.

- [ ] **Step 1: Criar o Client Component do card de conexão com botão de teste**

```tsx
// app/dashboard/configuracoes/connection-card.tsx
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { testConnectionAction } from "./actions";
import type { ConnectionStatus, TestableIntegrationKey } from "@/lib/connections/status";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Configurado",
  not_configured: "Não configurado",
};

export function ConnectionCard({
  integrationKey,
  title,
  description,
  status,
}: {
  integrationKey: TestableIntegrationKey;
  title: string;
  description: string;
  status: ConnectionStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleTest() {
    setResult(null);
    startTransition(async () => {
      const outcome = await testConnectionAction(integrationKey);
      setResult(outcome);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {title}
          <span
            className={
              status === "connected"
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            }
          >
            {STATUS_LABEL[status]}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="outline" size="sm" onClick={handleTest} disabled={isPending || status !== "connected"}>
          {isPending ? "Testando..." : "Testar conexão"}
        </Button>
        {status !== "connected" && (
          <p className="text-xs text-muted-foreground">Configure as variáveis de ambiente para habilitar o teste.</p>
        )}
        {result && (
          <p className={result.ok ? "text-xs text-green-700" : "text-xs text-destructive"}>{result.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Criar o Client Component da seção de API Keys (criar + listar + revogar)**

```tsx
// app/dashboard/configuracoes/api-keys-section.tsx
"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type CreateApiKeyState,
  type RevokeApiKeyState,
} from "./actions";
import type { ApiKeyRow } from "@/lib/api-keys/api-keys";

const CREATE_INITIAL_STATE: CreateApiKeyState = { error: null, plaintext: null, name: null };
const REVOKE_INITIAL_STATE: RevokeApiKeyState = { error: null };

function RevokeButton({ id }: { id: string }) {
  const [state, formAction, isPending] = useActionState(revokeApiKeyAction, REVOKE_INITIAL_STATE);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="destructive" size="xs" disabled={isPending}>
        {isPending ? "Revogando..." : "Revogar"}
      </Button>
      {state.error && <span className="ml-2 text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

export function ApiKeysSection({ keys, webhookUrl }: { keys: ApiKeyRow[]; webhookUrl: string }) {
  const [state, formAction, isPending] = useActionState(createApiKeyAction, CREATE_INITIAL_STATE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Keys</CardTitle>
        <CardDescription>
          Chaves usadas por sistemas externos (ex.: n8n) para autenticar chamadas ao webhook de ingestão em{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{webhookUrl}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={formAction} className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="name">Nome da chave</Label>
            <Input id="name" name="name" placeholder="ex.: n8n produção" required />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Criando..." : "Criar chave"}
          </Button>
        </form>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        {state.plaintext && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm">
            <p className="font-medium">Chave &quot;{state.name}&quot; criada. Copie agora — ela não será mostrada de novo:</p>
            <code className="mt-2 block break-all rounded bg-background p-2 text-xs">{state.plaintext}</code>
          </div>
        )}

        <div className="space-y-2">
          {keys.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma chave criada ainda.</p>}
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div>
                <p className="font-medium">
                  {key.name} <span className="font-mono text-xs text-muted-foreground">{key.key_prefix}…</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  criada em {new Date(key.created_at).toLocaleString("pt-BR")}
                  {key.last_used_at && ` · último uso em ${new Date(key.last_used_at).toLocaleString("pt-BR")}`}
                  {key.revoked_at && " · revogada"}
                </p>
              </div>
              {!key.revoked_at && <RevokeButton id={key.id} />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Criar a página `app/dashboard/configuracoes/page.tsx` (Server Component)**

```tsx
// app/dashboard/configuracoes/page.tsx
import { getConnectionStatus, type TestableIntegrationKey } from "@/lib/connections/status";
import { listApiKeys } from "@/lib/api-keys/api-keys";
import { ConnectionCard } from "./connection-card";
import { ApiKeysSection } from "./api-keys-section";

export const dynamic = "force-dynamic";

const INTEGRATIONS: { key: TestableIntegrationKey; title: string; description: string }[] = [
  { key: "drive", title: "Google Drive", description: "Ingestão de material bruto via pasta observada." },
  { key: "telegram", title: "Telegram", description: "Bot para upload rápido de material bruto." },
  { key: "openrouter", title: "OpenRouter", description: "Geração de legenda/manchete por IA." },
  { key: "creatomate", title: "Creatomate", description: "Render de vídeo por template." },
  { key: "zernio", title: "Zernio", description: "Publicação/agendamento no Instagram e analytics." },
];

export default async function ConfiguracoesPage() {
  const [connectionStatuses, apiKeys] = await Promise.all([
    Promise.all(INTEGRATIONS.map(async (i) => [i.key, await getConnectionStatus(i.key)] as const)),
    listApiKeys(),
  ]);
  const n8nStatus = await getConnectionStatus("n8n");
  const statusMap = Object.fromEntries(connectionStatuses);

  const webhookUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/api/n8n/webhook`;

  return (
    <div className="space-y-8 p-6">
      <section>
        <h1 className="text-lg font-semibold">Conexões</h1>
        <p className="text-sm text-muted-foreground">
          Status das integrações externas. Credenciais são configuradas via variáveis de ambiente (Vercel) — esta
          tela reflete o estado atual e permite testar a conectividade.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((integration) => (
            <ConnectionCard
              key={integration.key}
              integrationKey={integration.key}
              title={integration.title}
              description={integration.description}
              status={statusMap[integration.key]}
            />
          ))}
          <ConnectionCard
            integrationKey={"n8n" as TestableIntegrationKey}
            title="n8n"
            description="Webhook de ingestão para automações externas — não tem teste de conectividade (é o n8n quem chama o Puzzle Records)."
            status={n8nStatus}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">API Keys</h2>
        <div className="mt-4">
          <ApiKeysSection keys={apiKeys} webhookUrl={webhookUrl} />
        </div>
      </section>
    </div>
  );
}
```

**Nota:** o card do n8n reaproveita `ConnectionCard`, mas como `n8n` não está em `TestableIntegrationKey`, o botão "Testar conexão" ficaria desabilitado incondicionalmente para esse card se clicado (chamaria `testConnectionAction("n8n")`, que não existe em `TEST_FUNCTIONS` e lançaria). Para não deixar esse caminho quebrado, ajustar `ConnectionCard` no Step 1 para aceitar uma prop opcional `testable?: boolean` (default `true`) e, quando `false`, nunca renderizar o botão "Testar conexão" — usado só pelo card do n8n. Refazer o Step 1 com essa prop antes de prosseguir:

- [ ] **Step 3b: Adicionar a prop `testable` ao `ConnectionCard` e usá-la no card do n8n**

Em `app/dashboard/configuracoes/connection-card.tsx`, adicionar `testable = true` à assinatura de props e envolver o bloco do botão:

```tsx
export function ConnectionCard({
  integrationKey,
  title,
  description,
  status,
  testable = true,
}: {
  integrationKey: TestableIntegrationKey;
  title: string;
  description: string;
  status: ConnectionStatus;
  testable?: boolean;
}) {
  // ... (isPending, result, handleTest sem mudança)

  return (
    <Card>
      {/* CardHeader sem mudança */}
      <CardContent className="space-y-2">
        {testable && (
          <Button variant="outline" size="sm" onClick={handleTest} disabled={isPending || status !== "connected"}>
            {isPending ? "Testando..." : "Testar conexão"}
          </Button>
        )}
        {testable && status !== "connected" && (
          <p className="text-xs text-muted-foreground">Configure as variáveis de ambiente para habilitar o teste.</p>
        )}
        {result && (
          <p className={result.ok ? "text-xs text-green-700" : "text-xs text-destructive"}>{result.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

E em `page.tsx`, no card do n8n, adicionar `testable={false}` e remover o cast `as TestableIntegrationKey` (trocar a prop `integrationKey` para aceitar `IntegrationKey` completo em vez de só `TestableIntegrationKey` — ajustar a assinatura de `ConnectionCard` para `integrationKey: string` já que, com `testable={false}`, o valor nunca é passado para `testConnectionAction`):

```tsx
          <ConnectionCard
            integrationKey="n8n"
            title="n8n"
            description="Webhook de ingestão para automações externas — não tem teste de conectividade (é o n8n quem chama o Puzzle Records)."
            status={n8nStatus}
            testable={false}
          />
```

(E trocar o tipo de `integrationKey` em `connection-card.tsx` de `TestableIntegrationKey` para `string`, já que `handleTest` só é alcançável quando `testable` é `true` — nesse caso o chamador sempre passa uma `TestableIntegrationKey` de fato, mas o tipo da prop não precisa mais forçar isso em tempo de compilação para o card do n8n funcionar.)

- [ ] **Step 4: Rodar o build e o lint**

Run: `npm run build`
Expected: build passa sem erros de tipo

Run: `npm run lint`
Expected: sem erros novos

- [ ] **Step 5: QA manual local**

Run: `npm run dev`, logar como usuário `admin`, navegar para `/dashboard/configuracoes`:
- Confirmar que os 6 cards de Conexões aparecem com o status correto conforme as env vars locais (`.env.local`).
- Clicar em "Testar conexão" num card configurado e confirmar que a mensagem de resultado aparece.
- Criar uma API key, confirmar que o texto puro aparece uma única vez e que a lista abaixo mostra o prefixo.
- Recarregar a página e confirmar que o texto puro não reaparece (só o prefixo).
- Revogar a chave e confirmar que ela é marcada como revogada na lista.
- Logar como usuário `equipe_conteudo` ou `editorial` e confirmar que `/dashboard/configuracoes` não aparece na sidebar e retorna redirecionamento se acessada diretamente pela URL (comportamento já garantido por `lib/auth/permissions.ts`, só confirmar que não regrediu).

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/configuracoes/
git commit -m "feat: adiciona pagina de Configuracoes com Conexoes e gestao de API Keys"
```

---

### Task 8: Testar o fluxo do webhook do n8n de ponta a ponta e atualizar `.docs/PLAN.md`

**Files:**
- Modify: `.docs/PLAN.md`

**Interfaces:**
- Consumes: nada (documentação).
- Produces: nada consumido por outra task — última task do plano.

- [ ] **Step 1: QA manual do webhook do n8n contra o ambiente local**

Com o servidor local rodando (`npm run dev`) e uma API key criada na Task 7 (copiar o valor em texto puro exibido na criação):

```bash
curl -X POST http://localhost:3000/api/n8n/webhook \
  -H "Authorization: Bearer <chave-copiada>" \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "teste-manual-1",
    "title": "Gancho de teste via n8n",
    "author": "QA manual",
    "mediaUrl": "https://picsum.photos/seed/puzzlerecords/600/800.jpg",
    "mimeType": "image/jpeg"
  }'
```

Expected: resposta `200 {"ok":true,"pipelineItemId":"<uuid>"}` e o item aparece em `/dashboard/kanban` na coluna "Recebido" com a origem "n8n".

Repetir a mesma chamada uma segunda vez (mesmo `externalId`) e confirmar que não cria um item duplicado (dedup via `unique(origin, external_id)`, mesmo comportamento já coberto pelos testes de `upsertPipelineItem`).

Chamar sem header `Authorization` e confirmar `401`.

- [ ] **Step 2: Atualizar `.docs/PLAN.md`**

Adicionar uma nova subseção ao final do arquivo, após a seção "Checklist de QA manual end-to-end (Task 13)":

```markdown
## Configurações — Conexões, API Keys e webhook n8n (2026-09-18)

**Status**: implementado — view `/dashboard/configuracoes` (admin-only) com duas seções:
- **Conexões**: 6 cards (Drive, Telegram, OpenRouter, Creatomate, Zernio, n8n) refletindo o estado real via presença de env vars, com botão "Testar conexão" fazendo uma chamada leve real a cada API (exceto n8n, que não tem credencial de saída).
- **API Keys**: tela para criar/listar/revogar chaves (tabela `api_keys`, hash SHA-256, texto puro exibido uma única vez na criação) — usadas para autenticar chamadas recebidas de automações externas.

**Novo canal de ingestão**: `app/api/n8n/webhook/route.ts` — endpoint genérico autenticado por API key (header `Authorization: Bearer`), espelhando o padrão do Telegram (baixa a mídia de `mediaUrl`, salva no bucket `raw-media`, cria `pipeline_items` em "recebido" com `origin: "n8n"`, enfileira a geração de legenda). `pipeline_items.origin` foi ampliado para aceitar `'n8n'` via `supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql`.

**Pendência manual**: aplicar `supabase/migrations/00000000000004_add_api_keys_and_n8n_origin.sql` no projeto Supabase real (mesmo processo manual via SQL Editor das migrations anteriores — sem acesso à connection string direta do Postgres para automatizar via CLI).

**Fora de escopo desta rodada**: o tema visual completo do `Design.md` (cores de marca magenta, tipografia Barlow Condensed/Public Sans/IBM Plex Mono) não foi aplicado — a página nova segue o mesmo Tailwind/shadcn neutro já usado no resto do dashboard, para manter consistência com o código existente. As sub-seções "Templates", "Regras de aprovação" e "Geral" descritas no protótipo do `Design.md` também não foram construídas.
```

- [ ] **Step 3: Commit**

```bash
git add .docs/PLAN.md
git commit -m "docs: registra a implementacao de Configuracoes, API Keys e webhook n8n no PLAN.md"
```

---

## Resumo do que será desenvolvido

1. **Migration** — tabela `api_keys` (hash SHA-256, nunca texto puro) + `pipeline_items.origin` aceita `'n8n'`.
2. **`lib/api-keys/api-keys.ts`** — gerar, criar, listar, revogar e verificar API keys.
3. **Ampliação de tipos** — `PipelineItemOrigin` inclui `"n8n"`; Kanban exibe o label corretamente.
4. **`app/api/n8n/webhook/route.ts`** — webhook de ingestão pronto para o n8n conectar, autenticado por API key, criando itens no pipeline em "recebido" (3º canal, ao lado de Drive e Telegram).
5. **`lib/connections/status.ts`** — status de configuração (env vars) e teste de conectividade real para Drive, Telegram, OpenRouter, Creatomate e Zernio.
6. **Server Actions** (`app/dashboard/configuracoes/actions.ts`) — testar conexão, criar API key, revogar API key, todas com checagem de papel `admin` própria (defesa em profundidade).
7. **Página `/dashboard/configuracoes`** — seção Conexões (6 cards com status + teste) e seção API Keys (criar, listar com prefixo mascarado, revogar), usando os componentes shadcn já existentes no projeto.
8. **QA manual do webhook + atualização do `.docs/PLAN.md`** documentando o incremento e a pendência de aplicar a migration em produção.

**Fora de escopo, registrado como pendência futura**: aplicar o tema visual completo do `Design.md` (cores de marca, tipografia) a todo o dashboard, e construir as sub-seções "Templates", "Regras de aprovação" e "Geral" de Configurações.
