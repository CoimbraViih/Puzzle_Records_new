# Fase 1 — Ingestão — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** material bruto (foto/vídeo) entra no sistema por dois canais — pasta observada no Google Drive e bot do Telegram — e vira um item no Kanban em status `recebido`, com metadados de origem/autor, sem duplicar mesmo se webhook e polling processarem o mesmo evento.

**Architecture:** duas fontes de ingestão, cada uma com um endpoint de webhook (`app/api/drive/webhook`, `app/api/telegram/webhook`) mais um endpoint de polling/renovação disparado por Vercel Cron para o Drive (a API de push notifications do Drive expira e pode falhar). Toda a lógica de deduplicação e gravação passa por uma única função compartilhada (`upsertPipelineItem`) que faz `upsert` com `on conflict (origin, external_id) do nothing` numa nova tabela `public.pipeline_items`. **Decisão registrada nesta fase:** os handlers gravam direto no Supabase de forma síncrona — **não** passam pela fila `ingestionQueue`/BullMQ ainda (ver "Desvio de arquitetura" abaixo). O Kanban (`/dashboard/kanban`, rota que já existe no menu mas não tem página) fica só de leitura por enquanto, mostrando as 6 colunas do pipeline com dados reais apenas em `recebido`.

**Tech Stack:** Next.js 16.3.5 (App Router, Route Handlers), TypeScript, Supabase (Postgres + RLS + Storage, `@supabase/supabase-js` service-role client), `googleapis` (Drive API v3 + JWT de conta de serviço), `grammy` (bot Telegram via webhook), Vitest 5 (testes unitários das funções puras de mapeamento/dedupe), Vercel Cron (`vercel.ts`).

---

## Desvio de arquitetura (registrar e revisitar)

`.docs/CLAUDE.md` descreve "cada etapa do pipeline é um job de fila" via Redis+BullMQ. Nesta fase, **por decisão explícita**, os dois webhooks de ingestão escrevem direto no Supabase, sem enfileirar em `ingestionQueue`. Motivo: `workers/index.ts` ainda não tem um `Worker` real e a Vercel (serverless) não sustenta um processo BullMQ ouvindo 24/7 sem uma peça de infra adicional (cron-drain ou host separado) — decisão que foi adiada. `ingestionQueue` continua existindo em `workers/queues.ts` mas não é usada por esta fase. **Antes da Fase 2** (job de fila para gerar legenda) essa lacuna precisa ser resolvida, porque a Fase 2 exige um consumidor de fila de verdade. Este plano não tenta resolver isso agora — só deixa o registro para não ser esquecido.

## Estado verificado antes de escrever este plano

- Não existe `app/api/` no projeto — esta fase cria o primeiro Route Handler do repo. Next.js 16.3.5: `context.params` é `Promise`, existe `RouteContext<'/path'>` gerado, e Route Handlers dinâmicos (que leem `request.body`/headers) já saem do cache automaticamente — mesmo assim vamos marcar `export const dynamic = "force-dynamic"` nos webhooks para não depender de inferência implícita.
- `proxy.ts` (renomeado de `middleware.ts` no Next 16) só intercepta `/login*` e `/dashboard*`; qualquer outro caminho (inclusive `/api/*`) recebe `NextResponse.next()` sem modificação. **Não precisa mudar `proxy.ts`** para os webhooks passarem — só precisa validar isso na QA manual (Tarefa 10), porque verificação de assinatura de webhook é sensível a qualquer mutação de request.
- `profiles` já existe em produção, tem RLS e uma função `is_admin()` própria que **não é confiável** (retornou "permission denied" antes) — não usar. Papéis reais: `equipe_conteudo`, `editorial`, `admin` (texto livre em `profiles.role`). Seguir o padrão já usado em `audit_log`: função `security definer` própria para checar papel.
- Não existe nenhuma tabela de pipeline/kanban ainda — esta fase cria `public.pipeline_items` do zero.
- `workers/connection.ts` e `workers/queues.ts` já existem (Redis/BullMQ prontos), mas não serão usados por esta fase (ver desvio acima).
- Nenhuma dependência de Google Drive ou Telegram está instalada (`googleapis`, `google-auth-library`, `grammy`, `node-telegram-bot-api`, `telegraf` — nenhuma presente).
- `.env.local`/`.env.example` só têm as 4 vars do Supabase/Redis da Fase 0.
- Convenção de testes: Vitest, arquivo `*.test.ts` colocado ao lado do source, `describe`/`it` em português, só funções puras (nada de integração real com Supabase/Redis/APIs externas é testado hoje) — esta fase segue o mesmo padrão.
- Não existe `vercel.json` nem `vercel.ts` no projeto — esta fase cria o `vercel.ts` (convenção recomendada atualmente pela Vercel) só com os `crons` necessários.

## Pré-requisitos que o humano precisa confirmar/fazer antes de começar

1. **Conta de serviço do Google** com acesso à pasta do Drive que será observada (compartilhar a pasta com o e-mail da service account, papel "Leitor" basta) — gerar a chave JSON e extrair `client_email` e `private_key`.
2. **ID da pasta do Drive** a ser observada (`GOOGLE_DRIVE_FOLDER_ID`).
3. **Bot do Telegram criado via @BotFather**, com o token (`TELEGRAM_BOT_TOKEN`).
4. Definir `PUBLIC_BASE_URL` (a URL pública da Vercel, ex.: `https://puzzlerecordsnew.vercel.app`) — necessária para registrar o webhook do Drive (`channel.address`) e do Telegram (`setWebhook`).
5. Gerar dois segredos aleatórios: `GOOGLE_DRIVE_WEBHOOK_TOKEN` (token que o Google devolve em `X-Goog-Channel-Token` — usado para validar que a notificação é legítima) e `TELEGRAM_WEBHOOK_SECRET` (usado como `secret_token` no `setWebhook`, validado contra o header `X-Telegram-Bot-Api-Secret-Token`).
6. Gerar `CRON_SECRET` (string aleatória) para proteger os endpoints de polling/renovação chamados pelo Vercel Cron.
7. Aplicar a migration desta fase (Tarefa 1) no Supabase real — mesma restrição da Fase 0: sem connection string direta do Postgres, então precisa ser colada no SQL Editor do Supabase Studio, **ou** usar a ferramenta MCP do Supabase (`apply_migration`) se o usuário autorizar o uso dela nesta sessão.
8. Todas as 6 novas env vars (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_WEBHOOK_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `PUBLIC_BASE_URL`) precisam estar em `.env.local` (dev) e em Project Settings → Environment Variables na Vercel (prod) antes do deploy final.

---

## Task 1: Migration — tabela `pipeline_items` + estado de sync do Drive + bucket de storage

**Files:**
- Create: `supabase/migrations/00000000000002_add_pipeline_items.sql`

**Step 1: Escrever a migration**

```sql
-- pipeline_items: um item por material bruto ingerido (Drive ou Telegram)
create table public.pipeline_items (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('drive', 'telegram')),
  external_id text not null, -- id do arquivo no Drive, ou file_unique_id do Telegram
  status text not null default 'recebido'
    check (status in ('recebido', 'legenda', 'renderizando', 'aguardando_aprovacao', 'agendado', 'publicado', 'rejeitado')),
  title text,
  author text, -- e-mail do dono do arquivo (Drive) ou username/id do Telegram
  mime_type text,
  drive_file_id text,
  storage_path text, -- caminho no bucket 'raw-media' (só Telegram, por enquanto)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origin, external_id)
);

create index pipeline_items_status_idx on public.pipeline_items (status);
create index pipeline_items_created_at_idx on public.pipeline_items (created_at desc);

alter table public.pipeline_items enable row level security;

-- mesmo padrão de audit_log: função security definer própria, não confiar em is_admin()
create or replace function public.pipeline_items_viewer_has_role()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('equipe_conteudo', 'editorial', 'admin')
  );
$$;

create policy "internal roles can read pipeline_items"
  on public.pipeline_items for select
  using (public.pipeline_items_viewer_has_role());

-- sem policy de insert/update: só o service_role (usado pelos webhooks) grava, bypassando RLS.

-- drive_sync_state: linha única com o estado do watch channel + pageToken de changes.list
create table public.drive_sync_state (
  id boolean primary key default true check (id), -- garante 1 linha só
  page_token text,
  channel_id text,
  channel_resource_id text,
  channel_expiration timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.drive_sync_state enable row level security;
-- sem policies: só service_role acessa (RLS habilitado sem policy = nega tudo pra authenticated/anon).

insert into storage.buckets (id, name, public)
values ('raw-media', 'raw-media', false)
on conflict (id) do nothing;
```

**Step 2: Aplicar a migration no Supabase real**

Colar o conteúdo no SQL Editor do Supabase Studio (mesmo processo da migration de `audit_log` na Fase 0) — ou, se autorizado nesta sessão, usar a tool MCP `mcp__claude_ai_Supabase__apply_migration`.

Verificar depois:
```sql
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('pipeline_items', 'drive_sync_state');
select id, public from storage.buckets where id = 'raw-media';
```
Expected: as duas tabelas existem, bucket `raw-media` existe com `public = false`.

**Step 3: Commit**

```bash
git add supabase/migrations/00000000000002_add_pipeline_items.sql
git commit -m "feat(db): add pipeline_items, drive_sync_state and raw-media bucket"
```

---

## Task 2: Dependências e env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Step 1: Instalar dependências**

Run: `npm install googleapis google-auth-library grammy`
Expected: as 3 entram em `dependencies` no `package.json` / `package-lock.json`.

**Step 2: Atualizar `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=

# Fase 1 — Ingestão
PUBLIC_BASE_URL=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_WEBHOOK_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
CRON_SECRET=
```

**Step 3: Preencher `.env.local` com valores reais** (não versionado — ação manual do humano, ver Pré-requisitos).

**Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Drive/Telegram deps and Fase 1 env var template"
```

---

## Task 3: Helper compartilhado de upsert com dedupe — `lib/ingestion/pipeline-items.ts`

**Files:**
- Create: `lib/ingestion/pipeline-items.ts`
- Test: `lib/ingestion/pipeline-items.test.ts`

**Step 1: Escrever o teste (função pura de mapeamento, sem tocar no Supabase de verdade)**

```ts
// lib/ingestion/pipeline-items.test.ts
import { describe, it, expect } from "vitest";
import { buildPipelineItemPayload } from "./pipeline-items";

describe("buildPipelineItemPayload", () => {
  it("monta o payload de um item vindo do Drive", () => {
    const payload = buildPipelineItemPayload({
      origin: "drive",
      externalId: "1AbcDriveFileId",
      title: "foto-gancho.jpg",
      author: "editor@puzzlerecords.com",
      mimeType: "image/jpeg",
      driveFileId: "1AbcDriveFileId",
      metadata: { webViewLink: "https://drive.google.com/file/d/1AbcDriveFileId" },
    });

    expect(payload).toEqual({
      origin: "drive",
      external_id: "1AbcDriveFileId",
      status: "recebido",
      title: "foto-gancho.jpg",
      author: "editor@puzzlerecords.com",
      mime_type: "image/jpeg",
      drive_file_id: "1AbcDriveFileId",
      storage_path: null,
      metadata: { webViewLink: "https://drive.google.com/file/d/1AbcDriveFileId" },
    });
  });

  it("monta o payload de um item vindo do Telegram, com storage_path", () => {
    const payload = buildPipelineItemPayload({
      origin: "telegram",
      externalId: "AgADtelegram123",
      title: "Envio de @joaocontent",
      author: "@joaocontent",
      mimeType: "video/mp4",
      storagePath: "telegram/AgADtelegram123.mp4",
      metadata: { caption: "surtou de novo" },
    });

    expect(payload.origin).toBe("telegram");
    expect(payload.storage_path).toBe("telegram/AgADtelegram123.mp4");
    expect(payload.drive_file_id).toBeNull();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/ingestion/pipeline-items.test.ts`
Expected: FAIL — `buildPipelineItemPayload` não existe ainda.

**Step 3: Implementar**

```ts
// lib/ingestion/pipeline-items.ts
import { createClient } from "@supabase/supabase-js";

export type PipelineItemOrigin = "drive" | "telegram";

export interface BuildPipelineItemInput {
  origin: PipelineItemOrigin;
  externalId: string;
  title: string | null;
  author: string | null;
  mimeType: string | null;
  driveFileId?: string;
  storagePath?: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineItemPayload {
  origin: PipelineItemOrigin;
  external_id: string;
  status: "recebido";
  title: string | null;
  author: string | null;
  mime_type: string | null;
  drive_file_id: string | null;
  storage_path: string | null;
  metadata: Record<string, unknown>;
}

export function buildPipelineItemPayload(input: BuildPipelineItemInput): PipelineItemPayload {
  return {
    origin: input.origin,
    external_id: input.externalId,
    status: "recebido",
    title: input.title,
    author: input.author,
    mime_type: input.mimeType,
    drive_file_id: input.driveFileId ?? null,
    storage_path: input.storagePath ?? null,
    metadata: input.metadata ?? {},
  };
}

function getServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Idempotente: se (origin, external_id) já existe, não faz nada e retorna null.
 * Cobre o caso de webhook + polling processarem o mesmo arquivo.
 */
export async function upsertPipelineItem(input: BuildPipelineItemInput) {
  const supabase = getServiceRoleClient();
  const payload = buildPipelineItemPayload(input);

  const { data, error } = await supabase
    .from("pipeline_items")
    .upsert(payload, { onConflict: "origin,external_id", ignoreDuplicates: true })
    .select("id, external_id")
    .maybeSingle();

  if (error) throw error;
  return data; // null quando já existia (ignoreDuplicates não retorna a linha existente)
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run lib/ingestion/pipeline-items.test.ts`
Expected: PASS (2 testes).

**Step 5: Commit**

```bash
git add lib/ingestion/pipeline-items.ts lib/ingestion/pipeline-items.test.ts
git commit -m "feat: add pipeline_items upsert helper with dedupe"
```

---

## Task 4: Cliente Google Drive + sync de changes — `lib/ingestion/google-drive.ts`

**Files:**
- Create: `lib/ingestion/google-drive.ts`
- Test: `lib/ingestion/google-drive.test.ts`

**Step 1: Escrever teste da função pura de filtro/mapeamento**

```ts
// lib/ingestion/google-drive.test.ts
import { describe, it, expect } from "vitest";
import { isRelevantDriveChange } from "./google-drive";

describe("isRelevantDriveChange", () => {
  it("aceita arquivo cujo pai é a pasta observada e não é papelera", () => {
    const relevant = isRelevantDriveChange(
      { fileId: "f1", removed: false, file: { id: "f1", parents: ["FOLDER_ID"], trashed: false } },
      "FOLDER_ID",
    );
    expect(relevant).toBe(true);
  });

  it("ignora mudança de arquivo removido/na lixeira", () => {
    const relevant = isRelevantDriveChange(
      { fileId: "f1", removed: true },
      "FOLDER_ID",
    );
    expect(relevant).toBe(false);
  });

  it("ignora arquivo de outra pasta", () => {
    const relevant = isRelevantDriveChange(
      { fileId: "f1", removed: false, file: { id: "f1", parents: ["OUTRA_PASTA"], trashed: false } },
      "FOLDER_ID",
    );
    expect(relevant).toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/ingestion/google-drive.test.ts`
Expected: FAIL — módulo não existe.

**Step 3: Implementar**

```ts
// lib/ingestion/google-drive.ts
import { google, type drive_v3 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { upsertPipelineItem } from "./pipeline-items";

type DriveChange = {
  fileId?: string | null;
  removed?: boolean | null;
  file?: Pick<drive_v3.Schema$File, "id" | "parents" | "trashed"> | null;
};

export function isRelevantDriveChange(change: DriveChange, watchedFolderId: string): boolean {
  if (change.removed) return false;
  const file = change.file;
  if (!file || file.trashed) return false;
  return (file.parents ?? []).includes(watchedFolderId);
}

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

async function getSyncState() {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.from("drive_sync_state").select("*").eq("id", true).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveSyncState(patch: Record<string, unknown>) {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("drive_sync_state")
    .upsert({ id: true, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

/**
 * Processa mudanças novas na pasta observada desde o último pageToken salvo.
 * Chamada tanto pelo webhook (push notification) quanto pelo polling (cron) —
 * é o único lugar que efetivamente cria pipeline_items a partir do Drive,
 * garantindo que os dois caminhos usem a mesma lógica de dedupe.
 */
export async function syncDriveChanges() {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
  let state = await getSyncState();

  let pageToken = state?.page_token;
  if (!pageToken) {
    const start = await drive.changes.getStartPageToken({});
    pageToken = start.data.startPageToken!;
    await saveSyncState({ page_token: pageToken });
  }

  let processed = 0;
  let nextPageToken: string | undefined = pageToken;

  while (nextPageToken) {
    const res = await drive.changes.list({
      pageToken: nextPageToken,
      fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,parents,trashed,mimeType,owners))",
    });

    for (const change of res.data.changes ?? []) {
      if (!isRelevantDriveChange(change, folderId)) continue;
      const file = change.file!;
      await upsertPipelineItem({
        origin: "drive",
        externalId: file.id!,
        title: file.name ?? null,
        author: file.owners?.[0]?.emailAddress ?? null,
        mimeType: file.mimeType ?? null,
        driveFileId: file.id!,
        metadata: {},
      });
      processed += 1;
    }

    if (res.data.newStartPageToken) {
      await saveSyncState({ page_token: res.data.newStartPageToken });
      nextPageToken = undefined;
    } else {
      nextPageToken = res.data.nextPageToken ?? undefined;
    }
  }

  return { processed };
}

/**
 * Cria (ou renova, se estiver perto de expirar) o watch channel do Drive.
 * O Drive não permite "watch" direto numa pasta — por isso observamos o feed
 * de changes inteiro e filtramos por pasta em isRelevantDriveChange.
 */
export async function ensureDriveWatchChannel() {
  const drive = getDriveClient();
  const state = await getSyncState();

  const expiresInMs = state?.channel_expiration ? new Date(state.channel_expiration).getTime() - Date.now() : -1;
  if (expiresInMs > 24 * 60 * 60 * 1000) {
    return { renewed: false };
  }

  if (state?.channel_id && state.channel_resource_id) {
    await drive.channels.stop({ requestBody: { id: state.channel_id, resourceId: state.channel_resource_id } }).catch(() => {});
  }

  if (!state?.page_token) {
    const start = await drive.changes.getStartPageToken({});
    await saveSyncState({ page_token: start.data.startPageToken! });
  }

  const channelId = crypto.randomUUID();
  const res = await drive.changes.watch({
    pageToken: (await getSyncState())!.page_token!,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${process.env.PUBLIC_BASE_URL}/api/drive/webhook`,
      token: process.env.GOOGLE_DRIVE_WEBHOOK_TOKEN,
    },
  });

  await saveSyncState({
    channel_id: channelId,
    channel_resource_id: res.data.resourceId,
    channel_expiration: res.data.expiration ? new Date(Number(res.data.expiration)).toISOString() : null,
  });

  return { renewed: true };
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run lib/ingestion/google-drive.test.ts`
Expected: PASS (3 testes) — só a função pura `isRelevantDriveChange` é exercitada; `syncDriveChanges`/`ensureDriveWatchChannel` dependem de rede/Supabase reais e são validadas na QA manual (Tarefa 10).

**Step 5: Commit**

```bash
git add lib/ingestion/google-drive.ts lib/ingestion/google-drive.test.ts
git commit -m "feat: add Google Drive changes sync and watch channel management"
```

---

## Task 5: Webhook do Drive — `app/api/drive/webhook/route.ts`

**Files:**
- Create: `app/api/drive/webhook/route.ts`

**Step 1: Implementar**

```ts
// app/api/drive/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { syncDriveChanges } from "@/lib/ingestion/google-drive";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-goog-channel-token");
  if (token !== process.env.GOOGLE_DRIVE_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "invalid channel token" }, { status: 401 });
  }

  const resourceState = request.headers.get("x-goog-resource-state");
  // "sync" é só o ping de confirmação ao criar o channel — nada pra processar ainda.
  if (resourceState === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  try {
    await syncDriveChanges();
  } catch (error) {
    console.error("[drive/webhook] falha ao sincronizar changes", error);
    // Responde 200 mesmo assim: o Google reenvia notificações "resource_state"
    // repetidas indefinidamente em caso de erro persistente, e o polling (Tarefa 6)
    // é a rede de segurança real contra perda de eventos.
  }

  return new NextResponse(null, { status: 200 });
}
```

**Step 2: Commit**

```bash
git add app/api/drive/webhook/route.ts
git commit -m "feat: add Google Drive push notification webhook"
```

---

## Task 6: Polling de segurança do Drive (cron) — `app/api/drive/poll/route.ts`

**Files:**
- Create: `app/api/drive/poll/route.ts`
- Create: `lib/ingestion/cron-auth.ts`
- Test: `lib/ingestion/cron-auth.test.ts`

**Step 1: Teste da verificação de secret (função pura)**

```ts
// lib/ingestion/cron-auth.test.ts
import { describe, it, expect } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

describe("isAuthorizedCronRequest", () => {
  it("aceita quando o Authorization bate com CRON_SECRET", () => {
    expect(isAuthorizedCronRequest("Bearer abc123", "abc123")).toBe(true);
  });

  it("rejeita header ausente", () => {
    expect(isAuthorizedCronRequest(null, "abc123")).toBe(false);
  });

  it("rejeita secret errado", () => {
    expect(isAuthorizedCronRequest("Bearer errado", "abc123")).toBe(false);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/ingestion/cron-auth.test.ts`
Expected: FAIL.

**Step 3: Implementar**

```ts
// lib/ingestion/cron-auth.ts
export function isAuthorizedCronRequest(authorizationHeader: string | null, expectedSecret: string): boolean {
  if (!authorizationHeader) return false;
  return authorizationHeader === `Bearer ${expectedSecret}`;
}
```

```ts
// app/api/drive/poll/route.ts
import { NextRequest, NextResponse } from "next/server";
import { syncDriveChanges } from "@/lib/ingestion/google-drive";
import { isAuthorizedCronRequest } from "@/lib/ingestion/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET!)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await syncDriveChanges();
  return NextResponse.json(result);
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run lib/ingestion/cron-auth.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**

```bash
git add app/api/drive/poll/route.ts lib/ingestion/cron-auth.ts lib/ingestion/cron-auth.test.ts
git commit -m "feat: add Drive polling safety-net endpoint with cron auth"
```

---

## Task 7: Renovação do watch channel (cron) — `app/api/drive/renew-channel/route.ts`

**Files:**
- Create: `app/api/drive/renew-channel/route.ts`

**Step 1: Implementar**

```ts
// app/api/drive/renew-channel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ensureDriveWatchChannel } from "@/lib/ingestion/google-drive";
import { isAuthorizedCronRequest } from "@/lib/ingestion/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET!)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await ensureDriveWatchChannel();
  return NextResponse.json(result);
}
```

**Step 2: Commit**

```bash
git add app/api/drive/renew-channel/route.ts
git commit -m "feat: add Drive watch channel renewal endpoint"
```

---

## Task 8: `vercel.ts` com os crons

**Files:**
- Create: `vercel.ts`

**Step 1: Instalar o pacote de config**

Run: `npm install --save-dev @vercel/config`

**Step 2: Implementar**

```ts
// vercel.ts
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    { path: "/api/drive/poll", schedule: "*/5 * * * *" },
    { path: "/api/drive/renew-channel", schedule: "0 3 * * *" },
  ],
};
```

**Step 3: Commit**

```bash
git add vercel.ts package.json package-lock.json
git commit -m "chore: schedule Drive polling and channel renewal via Vercel Cron"
```

---

## Task 9: Bot do Telegram — `lib/ingestion/telegram.ts`

**Files:**
- Create: `lib/ingestion/telegram.ts`
- Test: `lib/ingestion/telegram.test.ts`

**Step 1: Teste da função pura de extração de mídia da mensagem**

```ts
// lib/ingestion/telegram.test.ts
import { describe, it, expect } from "vitest";
import { extractMediaFromMessage } from "./telegram";

describe("extractMediaFromMessage", () => {
  it("extrai a maior foto de uma mensagem com array de tamanhos", () => {
    const media = extractMediaFromMessage({
      caption: "gancho aqui",
      photo: [
        { file_id: "small", file_unique_id: "u-small", width: 90, height: 90 },
        { file_id: "big", file_unique_id: "u-big", width: 1280, height: 1280 },
      ],
    } as never);

    expect(media).toEqual({ fileId: "big", fileUniqueId: "u-big", mimeType: "image/jpeg", caption: "gancho aqui" });
  });

  it("extrai vídeo", () => {
    const media = extractMediaFromMessage({
      caption: null,
      video: { file_id: "v1", file_unique_id: "u-v1", mime_type: "video/mp4" },
    } as never);

    expect(media).toEqual({ fileId: "v1", fileUniqueId: "u-v1", mimeType: "video/mp4", caption: null });
  });

  it("retorna null quando não há mídia suportada", () => {
    const media = extractMediaFromMessage({ text: "oi" } as never);
    expect(media).toBeNull();
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/ingestion/telegram.test.ts`
Expected: FAIL.

**Step 3: Implementar**

```ts
// lib/ingestion/telegram.ts
import { Bot, webhookCallback, type Context } from "grammy";
import { createClient } from "@supabase/supabase-js";
import { upsertPipelineItem } from "./pipeline-items";

interface ExtractedMedia {
  fileId: string;
  fileUniqueId: string;
  mimeType: string;
  caption: string | null;
}

export function extractMediaFromMessage(message: Context["message"]): ExtractedMedia | null {
  if (!message) return null;
  const caption = "caption" in message ? message.caption ?? null : null;

  if ("photo" in message && message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, fileUniqueId: largest.file_unique_id, mimeType: "image/jpeg", caption };
  }

  if ("video" in message && message.video) {
    return {
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      mimeType: message.video.mime_type ?? "video/mp4",
      caption,
    };
  }

  return null;
}

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export function createTelegramBot() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

  bot.on("message", async (ctx) => {
    const media = extractMediaFromMessage(ctx.message);
    if (!media) {
      await ctx.reply("Envie uma foto ou vídeo para entrar no pipeline. Legenda opcional vira o gancho inicial.");
      return;
    }

    const file = await ctx.api.getFile(media.fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const fileResponse = await fetch(fileUrl);
    const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());

    const extension = media.mimeType.startsWith("video") ? "mp4" : "jpg";
    const storagePath = `telegram/${media.fileUniqueId}.${extension}`;

    const supabase = getServiceRoleClient();
    const { error: uploadError } = await supabase.storage
      .from("raw-media")
      .upload(storagePath, fileBytes, { contentType: media.mimeType, upsert: false });
    // upsert: false + erro "already exists" é esperado em reentrega do Telegram — ignora silenciosamente.
    if (uploadError && !uploadError.message.includes("already exists")) throw uploadError;

    const author = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "desconhecido");

    await upsertPipelineItem({
      origin: "telegram",
      externalId: media.fileUniqueId,
      title: media.caption,
      author,
      mimeType: media.mimeType,
      storagePath,
      metadata: { chatId: ctx.chat?.id },
    });

    await ctx.reply("Recebido! Já apareceu no Kanban em 'recebido'.");
  });

  return bot;
}

export function getTelegramWebhookHandler() {
  const bot = createTelegramBot();
  return webhookCallback(bot, "std/http", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run lib/ingestion/telegram.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**

```bash
git add lib/ingestion/telegram.ts lib/ingestion/telegram.test.ts
git commit -m "feat: add Telegram bot ingestion handler with media extraction"
```

---

## Task 10: Route handler do webhook do Telegram

**Files:**
- Create: `app/api/telegram/webhook/route.ts`

**Step 1: Implementar**

```ts
// app/api/telegram/webhook/route.ts
import { getTelegramWebhookHandler } from "@/lib/ingestion/telegram";

export const dynamic = "force-dynamic";

export const POST = getTelegramWebhookHandler();
```

> `grammy`'s `webhookCallback(..., "std/http", { secretToken })` já valida o header `X-Telegram-Bot-Api-Secret-Token` internamente e responde 401 se não bater — não precisa reimplementar essa checagem aqui.

**Step 2: Commit**

```bash
git add app/api/telegram/webhook/route.ts
git commit -m "feat: expose Telegram webhook route"
```

---

## Task 11: Script de registro do webhook do Telegram (execução manual, uma vez)

**Files:**
- Create: `scripts/setup-telegram-webhook.ts`

**Step 1: Implementar**

```ts
// scripts/setup-telegram-webhook.ts
// Rodar manualmente uma vez (e de novo se PUBLIC_BASE_URL ou o secret mudarem):
//   npx tsx scripts/setup-telegram-webhook.ts
import "dotenv/config";
import { Bot } from "grammy";

async function main() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
  await bot.api.setWebhook(`${process.env.PUBLIC_BASE_URL}/api/telegram/webhook`, {
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
  const info = await bot.api.getWebhookInfo();
  console.log("Webhook registrado:", info);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

**Step 2: Rodar manualmente contra o ambiente de produção**

Run: `npx tsx scripts/setup-telegram-webhook.ts`
Expected: log mostrando `url` igual a `PUBLIC_BASE_URL/api/telegram/webhook` e `pending_update_count: 0`.

**Step 3: Commit**

```bash
git add scripts/setup-telegram-webhook.ts
git commit -m "chore: add one-off script to register Telegram webhook"
```

---

## Task 12: Página do Kanban — `app/dashboard/kanban/page.tsx`

**Files:**
- Create: `app/dashboard/kanban/page.tsx`
- Modify: `lib/ingestion/pipeline-items.ts` (adicionar `getPipelineItemsByStatus`)

**Step 1: Adicionar leitura em `lib/ingestion/pipeline-items.ts`**

```ts
// adicionar ao final de lib/ingestion/pipeline-items.ts
import { createClient as createServerSupabaseClient } from "@supabase/supabase-js";

export interface PipelineItemRow {
  id: string;
  origin: PipelineItemOrigin;
  status: string;
  title: string | null;
  author: string | null;
  created_at: string;
}

const PIPELINE_STATUSES = [
  "recebido",
  "legenda",
  "renderizando",
  "aguardando_aprovacao",
  "agendado",
  "publicado",
] as const;

export async function getPipelineItemsGroupedByStatus() {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("pipeline_items")
    .select("id, origin, status, title, author, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const grouped = Object.fromEntries(PIPELINE_STATUSES.map((status) => [status, [] as PipelineItemRow[]]));
  for (const item of data ?? []) {
    (grouped[item.status] ??= []).push(item as PipelineItemRow);
  }
  return grouped as Record<(typeof PIPELINE_STATUSES)[number], PipelineItemRow[]>;
}

export { PIPELINE_STATUSES };
```

> Nota: esta função usa o client de service role para simplificar a Fase 1 (mesma factory já usada nos webhooks). Como a página já está atrás de `proxy.ts` (só usuários autenticados com papel válido chegam em `/dashboard/kanban`), o controle de acesso efetivo continua garantido — mas isso decide *não* depender da policy de RLS lida acima para a leitura da UI. Se preferir manter a leitura passando pela RLS (client autenticado do usuário, não service role), trocar por `createClient` de `lib/supabase/server.ts` nesta função antes de ir para produção.

**Step 2: Criar a página**

```tsx
// app/dashboard/kanban/page.tsx
import { getPipelineItemsGroupedByStatus, PIPELINE_STATUSES } from "@/lib/ingestion/pipeline-items";

const STATUS_LABELS: Record<string, string> = {
  recebido: "Recebido",
  legenda: "Legenda",
  renderizando: "Renderizando",
  aguardando_aprovacao: "Aguardando aprovação",
  agendado: "Agendado",
  publicado: "Publicado",
};

export default async function KanbanPage() {
  const grouped = await getPipelineItemsGroupedByStatus();

  return (
    <div className="flex gap-4 overflow-x-auto p-4">
      {PIPELINE_STATUSES.map((status) => (
        <div key={status} className="w-72 shrink-0 rounded-lg border bg-muted/30 p-3">
          <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
            {STATUS_LABELS[status]}
            <span className="text-muted-foreground">{grouped[status].length}</span>
          </h2>
          <div className="space-y-2">
            {grouped[status].length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum item.</p>
            )}
            {grouped[status].map((item) => (
              <div key={item.id} className="rounded-md border bg-background p-2 text-sm">
                <p className="font-medium">{item.title ?? "(sem título)"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.origin === "drive" ? "Drive" : "Telegram"} · {item.author ?? "autor desconhecido"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Verificar renderização local**

Run: `npm run dev`, acessar `/dashboard/kanban` autenticado.
Expected: 6 colunas visíveis, todas vazias até a Tarefa 13 popular `recebido` de verdade.

**Step 4: Commit**

```bash
git add app/dashboard/kanban/page.tsx lib/ingestion/pipeline-items.ts
git commit -m "feat: add read-only Kanban board grouped by pipeline status"
```

---

## Task 13: QA manual end-to-end (não automatizável sem mocks pesados de Drive/Telegram)

**Files:** nenhum (checklist de verificação manual).

**Step 1: Configurar ambiente**
- Preencher todas as env vars da Tarefa 2 em `.env.local` e na Vercel.
- Rodar `npx tsx scripts/setup-telegram-webhook.ts` contra a URL de produção.
- Chamar manualmente `GET /api/drive/renew-channel` (com `Authorization: Bearer $CRON_SECRET`) uma vez para criar o primeiro watch channel.

**Step 2: Testar caminho do Drive**
- Soltar um arquivo de imagem na pasta observada do Drive.
- Verificar que `POST /api/drive/webhook` é chamado (logs da Vercel) em poucos segundos e que um item aparece em `/dashboard/kanban` na coluna "Recebido" com origem "Drive".
- Chamar `GET /api/drive/poll` manualmente logo em seguida e confirmar que **não** cria um segundo item duplicado (dedupe por `(origin, external_id)`).

**Step 3: Testar caminho do Telegram**
- Enviar uma foto com legenda para o bot.
- Confirmar resposta "Recebido!" do bot e o item aparecendo em `/dashboard/kanban` com origem "Telegram", e o arquivo presente no bucket `raw-media` do Supabase Storage.
- Reenviar a mesma foto (Telegram às vezes reentrega updates) e confirmar que não duplica.

**Step 4: Confirmar que `proxy.ts` não interfere nos webhooks**
- Verificar nos logs da Vercel que as requisições `POST /api/drive/webhook` e `POST /api/telegram/webhook` chegam com o body/headers originais intactos (sem redirect, sem 3xx) — como esperado pela leitura do código em `proxy.ts` (só intercepta `/login*`/`/dashboard*`).

**Step 5:** nenhum commit nesta tarefa — é validação, não código.

---

## Task 14: Atualizar `.docs/PLAN.md` e `.docs/CLAUDE.md`

**Files:**
- Modify: `.docs/PLAN.md`
- Modify: `.docs/CLAUDE.md`

**Step 1:** marcar os entregáveis da Fase 1 como concluídos em `.docs/PLAN.md`, registrando o desvio de arquitetura (sem fila BullMQ nesta fase) e qualquer pendência manual restante (ex.: canal do Drive precisa de renovação periódica ativa via cron já configurado).

**Step 2:** atualizar o parágrafo "Estado atual" em `.docs/CLAUDE.md` para apontar Fase 1 como concluída e próximo passo = Fase 2 (Geração de legenda), mencionando que a fila BullMQ ainda precisa de um consumidor real antes da Fase 2 poder ser assíncrona de verdade.

**Step 3: Commit**

```bash
git add .docs/PLAN.md .docs/CLAUDE.md
git commit -m "docs: mark Fase 1 (Ingestão) as complete, flag BullMQ worker gap for Fase 2"
```

---

## Critério de pronto

- [ ] Um arquivo solto na pasta do Drive aparece no Kanban em `/dashboard/kanban`, coluna "Recebido", em poucos segundos.
- [ ] Uma foto/vídeo enviado ao bot do Telegram aparece no Kanban em `/dashboard/kanban`, coluna "Recebido", em poucos segundos, com o arquivo salvo no bucket `raw-media`.
- [ ] Disparar o polling manualmente logo após o webhook do Drive processar o mesmo arquivo **não** cria um item duplicado.
- [ ] Reenviar a mesma mensagem do Telegram **não** cria um item duplicado.
- [ ] Todos os itens novos têm metadados de origem (`drive`/`telegram`) e autor preenchidos.
- [ ] `npx vitest run` passa (todos os testes novos + os já existentes de `lib/auth/permissions.test.ts`).
- [ ] `.docs/PLAN.md` e `.docs/CLAUDE.md` refletem o estado real, incluindo o desvio de arquitetura registrado.
