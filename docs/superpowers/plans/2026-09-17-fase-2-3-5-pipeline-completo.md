# Fase 2 + Fase 3 + Fase 5 (MVP de teste) — Pipeline completo até publicar no Instagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o pipeline ponta a ponta — item "recebido" (Fase 1, já pronta) → legenda gerada por IA (Fase 2) → vídeo renderizado no Creatomate (Fase 3) → publicado no Instagram via Zernio (Fase 5, versão MVP) — resolvendo primeiro a lacuna arquitetural crítica apontada em `.docs/PLAN.md` (webhooks sem consumidor de fila assíncrona).

**Architecture:** BullMQ continua sendo a fila de durabilidade (`workers/queues.ts`), mas como a Vercel serverless não hospeda um `Worker` de longa duração, o consumo é feito por um padrão **cron-drain**: um endpoint `/api/queue/process` drena os jobs pendentes dentro de um orçamento de tempo, chamado tanto por Vercel Cron (a cada 5 min, rede de segurança) quanto por um disparo imediato "fire-and-forget" logo após cada `queue.add()` (mesmo padrão redundante webhook+poll já usado na ingestão da Fase 1). Cada etapa do pipeline é uma fila própria (`captionQueue`, `renderQueue`, `publishQueue`) com um processor puro e testável por trás.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + Storage, service role para jobs), BullMQ + Redis (Upstash), `@openrouter/sdk` (já instalado), Creatomate REST API (fetch nativo), Vitest.

**Spec:** `.docs/PRD.md` (seções 2, 3, 5, 8), `.docs/PLAN.md` (Fase 2, Fase 3, Fase 5), `.docs/CLAUDE.md`.

## Global Constraints

- **Gate de aprovação (Fase 4) foi deliberadamente pulado nesta versão de teste**, por decisão explícita do usuário durante o brainstorming deste plano — a Regra de Ouro do projeto (nenhum post sem aprovação humana) normalmente exige isso antes de qualquer publicação. A publicação dispara automaticamente assim que o render termina. **Isso precisa ser revisitado antes de uso real em produção** (risco jurídico/reputacional descrito no PRD §8) — o plano da Fase 4 real fica para uma iteração futura.
- Fila BullMQ não roda como `Worker` persistente na Vercel — usa padrão cron-drain (`/api/queue/process`), documentado acima.
- Toda mudança de status de `pipeline_items` grava uma linha em `audit_log` (`actor_id` null para jobs automáticos, já que não há usuário logado por trás).
- API real do Zernio é desconhecida (não documentada no treinamento do modelo e o usuário ainda não forneceu a documentação). Constrói-se a interface `ZernioClient` + `MockZernioClient` (usado por padrão, simula a publicação e loga o que faria) + `RealZernioClient` (stub que falha explicitamente, no mesmo estilo fail-closed de `requireEnv()` já usado no projeto) até a documentação real chegar.
- Template do Creatomate ainda não existe no editor visual — depende de ação manual do usuário (criar o template + fornecer `CREATOMATE_TEMPLATE_ID` e os nomes das camadas). O código já fica pronto, com nomes de camada configuráveis via env var, e testável via mocks até lá.
- Toda env var nova é adicionada a `.env.example` na mesma tarefa que a introduz.
- Fora de escopo deste plano (YAGNI para a versão de teste, registrado como pendência futura na Tarefa 13): relatórios/exportação e busca/filtros completos do dashboard (parte da Fase 5 do PRD, mas não necessários para "postar de verdade" uma vez).

---

### Task 1: Fila real — padrão cron-drain (resolve a lacuna crítica Fase 1 → Fase 2)

**Files:**
- Create: `lib/queue/drain.ts`
- Create: `lib/queue/drain.test.ts`
- Create: `lib/queue/trigger.ts`
- Modify: `workers/queues.ts`
- Create: `app/api/queue/process/route.ts`
- Modify: `vercel.ts`
- Modify: `.env.example` (nenhuma var nova nesta tarefa — reaproveita `CRON_SECRET` e `PUBLIC_BASE_URL` já existentes)

**Interfaces:**
- Produces: `drainQueue<T>(queue: Queue<T>, handler: (data: T) => Promise<void>, options?: { batchSize?: number; timeBudgetMs?: number }): Promise<number>` — usado pelas Tarefas 5, 8 e 10.
- Produces: `triggerQueueDrain(): void` — fire-and-forget, usado pelas Tarefas 5 e 8.
- Produces: `captionQueue`, `renderQueue`, `publishQueue` (instâncias `Queue` do BullMQ) exportadas de `workers/queues.ts` — usadas pelas Tarefas 5, 8, 10 e pelo próprio `app/api/queue/process/route.ts`.

- [ ] **Step 1: Escrever o teste de `drainQueue` (falha esperada — função ainda não existe)**

```typescript
// lib/queue/drain.test.ts
import { describe, it, expect, vi } from "vitest";
import type { Queue, Job } from "bullmq";
import { drainQueue } from "./drain";

function fakeJob(data: unknown): Job {
  return { id: "1", data, remove: vi.fn().mockResolvedValue(undefined) } as unknown as Job;
}

describe("drainQueue", () => {
  it("processa todos os jobs disponíveis e os remove", async () => {
    const jobs = [fakeJob({ n: 1 }), fakeJob({ n: 2 })];
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValueOnce(jobs).mockResolvedValueOnce([]),
    } as unknown as Queue;

    const handler = vi.fn().mockResolvedValue(undefined);
    const processed = await drainQueue(queue, handler, { timeBudgetMs: 5000 });

    expect(processed).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(jobs[0].remove).toHaveBeenCalled();
    expect(jobs[1].remove).toHaveBeenCalled();
  });

  it("não trava a fila quando o handler falha — remove o job mesmo assim", async () => {
    const jobs = [fakeJob({ n: 1 })];
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValueOnce(jobs).mockResolvedValueOnce([]),
    } as unknown as Queue;

    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const processed = await drainQueue(queue, handler, { timeBudgetMs: 5000 });

    expect(processed).toBe(1);
    expect(jobs[0].remove).toHaveBeenCalled();
  });

  it("respeita o orçamento de tempo e não fica presa em loop infinito", async () => {
    const queue = {
      name: "test-queue",
      getJobs: vi.fn().mockResolvedValue([fakeJob({ n: 1 })]), // sempre retorna 1 job "novo"
    } as unknown as Queue;

    const handler = vi.fn().mockResolvedValue(undefined);
    const start = Date.now();
    await drainQueue(queue, handler, { timeBudgetMs: 50 });
    expect(Date.now() - start).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/queue/drain.test.ts`
Expected: FAIL com "Cannot find module './drain'"

- [ ] **Step 3: Implementar `drainQueue`**

```typescript
// lib/queue/drain.ts
import type { Queue } from "bullmq";

export interface DrainOptions {
  batchSize?: number;
  timeBudgetMs?: number;
}

/**
 * Consome jobs de uma fila BullMQ dentro de um orçamento de tempo, sem
 * depender de um Worker de longa duração (que a Vercel serverless não
 * hospeda). Chamado a partir de um endpoint com cron + disparo imediato —
 * mesmo padrão redundante já usado na ingestão (webhook + poll, Fase 1).
 */
export async function drainQueue<T>(
  queue: Queue<T>,
  handler: (data: T) => Promise<void>,
  options: DrainOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 20;
  const deadline = Date.now() + (options.timeBudgetMs ?? 60_000);
  let processed = 0;

  while (Date.now() < deadline) {
    const jobs = await queue.getJobs(["waiting", "delayed"], 0, batchSize - 1);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      try {
        await handler(job.data);
      } catch (err) {
        console.error(`[queue:${queue.name}] job ${job.id} falhou:`, err);
      } finally {
        await job.remove();
        processed += 1;
      }
    }
  }

  return processed;
}
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `npx vitest run lib/queue/drain.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Criar o disparo imediato fire-and-forget**

```typescript
// lib/queue/trigger.ts

/**
 * Dispara o drain da fila imediatamente após um enqueue, sem esperar o
 * próximo tick do cron (que roda a cada 5 min). Nunca lança erro nem
 * bloqueia quem chamou — o cron cobre o retry se essa chamada falhar.
 */
export function triggerQueueDrain(): void {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!baseUrl || !secret) return;

  fetch(`${baseUrl}/api/queue/process`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch((err) => {
    console.error("[queue] falha ao disparar drain imediato (cron cobre o retry):", err);
  });
}
```

- [ ] **Step 6: Adicionar as filas de Fase 2/3/5 em `workers/queues.ts`**

```typescript
// workers/queues.ts
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const ingestionQueue = new Queue("ingestion", { connection: redisConnection });
export const captionQueue = new Queue("caption", { connection: redisConnection });
export const renderQueue = new Queue("render", { connection: redisConnection });
export const publishQueue = new Queue("publish", { connection: redisConnection });
```

- [ ] **Step 7: Criar o endpoint de drain**

```typescript
// app/api/queue/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest, requireEnv } from "@/lib/ingestion/cron-auth";
import { captionQueue, renderQueue, publishQueue } from "@/workers/queues";
import { drainQueue } from "@/lib/queue/drain";
import { processCaptionJob } from "@/lib/captions/generate-caption";
import { processRenderJob } from "@/lib/render/generate-render";
import { processPublishJob } from "@/lib/publishing/publish-post";

export const dynamic = "force-dynamic";
export const maxDuration = 280;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), requireEnv("CRON_SECRET"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const captions = await drainQueue(captionQueue, processCaptionJob, { timeBudgetMs: 90_000 });
  const renders = await drainQueue(renderQueue, processRenderJob, { timeBudgetMs: 90_000 });
  const publishes = await drainQueue(publishQueue, processPublishJob, { timeBudgetMs: 60_000 });

  return NextResponse.json({ ok: true, processed: { captions, renders, publishes } });
}
```

Nota: este arquivo importa `processCaptionJob`, `processRenderJob` e `processPublishJob`, que só existem a partir das Tarefas 5, 8 e 10. O `npm run build`/`npm run test` completo só fica verde depois delas — normal em um plano incremental; rode `npx tsc --noEmit` apenas sobre os arquivos já criados nesta tarefa se quiser validar isoladamente antes.

- [ ] **Step 8: Registrar o cron no `vercel.ts`**

```typescript
// vercel.ts
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    { path: "/api/drive/poll", schedule: "*/5 * * * *" },
    { path: "/api/drive/renew-channel", schedule: "0 3 * * *" },
    { path: "/api/queue/process", schedule: "*/5 * * * *" },
  ],
};
```

- [ ] **Step 9: Commit**

```bash
git add lib/queue workers/queues.ts app/api/queue vercel.ts
git commit -m "feat: fila real via padrão cron-drain (resolve lacuna Fase 1 -> Fase 2)"
```

---

### Task 2: Migration (colunas Fase 2/3/5) + auditoria de eventos de sistema

**Files:**
- Create: `supabase/migrations/00000000000003_add_caption_render_publish.sql`
- Create: `lib/audit/log-system-event.ts`

**Interfaces:**
- Produces: `logSystemAuditEvent(event: { action: string; entityId: string; metadata?: Record<string, unknown> }): Promise<void>` — usado pelas Tarefas 5, 8 e 10.
- Produces: colunas novas em `pipeline_items`: `caption_headline`, `caption_body`, `caption_generated_at`, `caption_error`, `render_id`, `render_url`, `render_started_at`, `render_error`, `published_at`, `publish_post_id`, `publish_permalink`, `publish_error` — consumidas por todas as tarefas seguintes.

- [ ] **Step 1: Criar a migration**

```sql
-- supabase/migrations/00000000000003_add_caption_render_publish.sql
--
-- Fase 2 (legenda), Fase 3 (render) e Fase 5 (publicação): colunas novas em
-- pipeline_items para guardar o resultado de cada etapa do pipeline
-- assíncrono. Erros ficam em colunas *_error (visíveis no Kanban) em vez de
-- travar a fila — critério de pronto da Fase 2 do PLAN.md.

alter table public.pipeline_items
  add column caption_headline text,
  add column caption_body text,
  add column caption_generated_at timestamptz,
  add column caption_error text,
  add column render_id text,
  add column render_url text,
  add column render_started_at timestamptz,
  add column render_error text,
  add column published_at timestamptz,
  add column publish_post_id text,
  add column publish_permalink text,
  add column publish_error text;
```

Esta migration **não** é aplicada automaticamente — segue o mesmo processo manual das migrations 1 e 2 (colar no SQL Editor do Supabase Studio, ver pendência #2 da Fase 1 no `PLAN.md`). Registrar isso na Tarefa 13.

- [ ] **Step 2: Implementar o helper de auditoria de sistema**

```typescript
// lib/audit/log-system-event.ts
import { createClient } from "@supabase/supabase-js";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface SystemAuditEvent {
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Auditoria de transições disparadas por jobs automáticos (sem usuário
 * logado por trás) — actor_id fica null. Usa o client de service role porque
 * a policy de insert de audit_log exige auth.uid() = actor_id, que não
 * existe fora de uma sessão de usuário real.
 */
export async function logSystemAuditEvent(event: SystemAuditEvent): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("audit_log").insert({
    actor_id: null,
    action: event.action,
    entity_type: "pipeline_item",
    entity_id: event.entityId,
    metadata: event.metadata ?? {},
  });
  if (error) {
    console.error("[audit] falha ao gravar evento de auditoria:", error);
  }
}
```

Não há teste unitário dedicado aqui (mesma convenção do resto do código de I/O direto com Supabase, ex.: `upsertPipelineItem` em `lib/ingestion/pipeline-items.ts` também não tem teste próprio — só a função pura por trás é testada).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000003_add_caption_render_publish.sql lib/audit
git commit -m "feat: colunas de legenda/render/publicação + auditoria de eventos de sistema"
```

---

### Task 3: Utilitário de fuso horário (America/Sao_Paulo)

**Files:**
- Create: `lib/time/timezone.ts`
- Create: `lib/time/timezone.test.ts`

**Interfaces:**
- Produces: `formatUtcAsSaoPaulo(isoUtc: string): string` — usado pela Tarefa 12 (calendário).
- Produces: `utcToSaoPauloParts(isoUtc: string): { date: string; time: string }` — usado pela Tarefa 12 e disponível para uso futuro no calendário editorial.

- [ ] **Step 1: Escrever o teste (falha esperada)**

```typescript
// lib/time/timezone.test.ts
import { describe, it, expect } from "vitest";
import { utcToSaoPauloParts, formatUtcAsSaoPaulo } from "./timezone";

describe("utcToSaoPauloParts", () => {
  it("converte UTC para America/Sao_Paulo (UTC-3, sem horário de verão desde 2019)", () => {
    expect(utcToSaoPauloParts("2026-01-15T15:00:00Z")).toEqual({ date: "2026-01-15", time: "12:00" });
  });

  it("cruza a virada do dia corretamente", () => {
    expect(utcToSaoPauloParts("2026-01-01T02:00:00Z")).toEqual({ date: "2025-12-31", time: "23:00" });
  });
});

describe("formatUtcAsSaoPaulo", () => {
  it("retorna uma string não vazia formatada em pt-BR", () => {
    const formatted = formatUtcAsSaoPaulo("2026-01-15T15:00:00Z");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/time/timezone.test.ts`
Expected: FAIL com "Cannot find module './timezone'"

- [ ] **Step 3: Implementar**

```typescript
// lib/time/timezone.ts
const SAO_PAULO_TZ = "America/Sao_Paulo";

/**
 * O Zernio retorna horários em UTC (ver PRD §3) — toda exibição de
 * calendário/agendamento precisa passar por aqui antes de chegar na tela.
 */
export function formatUtcAsSaoPaulo(isoUtc: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(isoUtc));
}

export function utcToSaoPauloParts(isoUtc: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SAO_PAULO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(isoUtc)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `npx vitest run lib/time/timezone.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/time
git commit -m "feat: utilitário de conversão UTC -> America/Sao_Paulo"
```

---

### Task 4: Cliente OpenRouter + prompt de legenda (Fase 2)

**Files:**
- Create: `lib/captions/prompt.ts`
- Create: `lib/captions/prompt.test.ts`
- Create: `lib/captions/openrouter-client.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `requireEnv(name: string): string` de `lib/ingestion/cron-auth.ts` (já existe).
- Produces: `buildCaptionMessages(context: CaptionPromptContext): Array<{ role: "system" | "user"; content: string }>` e `CAPTION_JSON_SCHEMA` — usados só dentro de `openrouter-client.ts`.
- Produces: `requestCaptionFromOpenRouter(context: CaptionContext): Promise<{ headline: string; body: string }>` — usado pela Tarefa 5.
- Produces: `type CaptionPromptContext = { title: string | null; author: string | null; origin: "drive" | "telegram" }`.

- [ ] **Step 1: Escrever o teste do prompt (falha esperada)**

```typescript
// lib/captions/prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildCaptionUserPrompt, buildCaptionMessages } from "./prompt";

describe("buildCaptionUserPrompt", () => {
  it("inclui título e autor quando presentes", () => {
    const prompt = buildCaptionUserPrompt({ title: "flagra no show", author: "@fã123", origin: "telegram" });
    expect(prompt).toContain("flagra no show");
    expect(prompt).toContain("@fã123");
    expect(prompt).toContain("Telegram");
  });

  it("indica ausência de título/autor sem inventar nada", () => {
    const prompt = buildCaptionUserPrompt({ title: null, author: null, origin: "drive" });
    expect(prompt).toContain("Nenhum título ou gancho foi enviado");
    expect(prompt).toContain("Autor do envio não identificado");
    expect(prompt).toContain("Google Drive");
  });
});

describe("buildCaptionMessages", () => {
  it("retorna mensagem system + user, nessa ordem", () => {
    const messages = buildCaptionMessages({ title: "x", author: "y", origin: "drive" });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("o system prompt instrui a não inventar fatos sobre pessoas reais", () => {
    const [system] = buildCaptionMessages({ title: null, author: null, origin: "drive" });
    expect(system.content.toLowerCase()).toContain("nunca invente fatos");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/captions/prompt.test.ts`
Expected: FAIL com "Cannot find module './prompt'"

- [ ] **Step 3: Implementar o prompt**

```typescript
// lib/captions/prompt.ts
export interface CaptionPromptContext {
  title: string | null;
  author: string | null;
  origin: "drive" | "telegram";
}

const SYSTEM_PROMPT = `Você é o gerador de manchete e legenda da Puzzle Records, uma página de fofoca musical no estilo Choquei/Léo Dias.

Regras obrigatórias:
- NUNCA invente fatos, declarações, datas ou eventos sobre pessoas reais. Use apenas as informações fornecidas no contexto.
- Se o contexto for insuficiente para uma manchete factual, produza uma manchete genérica de expectativa (ex: "algo está rolando") em vez de inventar detalhes.
- Tom: impactante, direto, estilo "AGORA"/"IMPACTO", mas sem sensacionalismo caluniador.
- headline: até 90 caracteres, gancho de abertura.
- body: 2 a 4 frases, legenda pronta para postar no Instagram.`;

export function buildCaptionUserPrompt(context: CaptionPromptContext): string {
  const parts = [
    `Origem do material: ${context.origin === "drive" ? "Google Drive" : "Telegram"}.`,
    context.title
      ? `Título/legenda original enviada: "${context.title}".`
      : "Nenhum título ou gancho foi enviado junto com o material.",
    context.author ? `Enviado por: ${context.author}.` : "Autor do envio não identificado.",
  ];
  return parts.join("\n");
}

export function buildCaptionMessages(context: CaptionPromptContext) {
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildCaptionUserPrompt(context) },
  ];
}

export const CAPTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Manchete de impacto, até 90 caracteres, estilo AGORA/IMPACTO" },
    body: { type: "string", description: "Legenda do post, 2 a 4 frases, tom Choquei/Léo Dias" },
  },
  required: ["headline", "body"],
  additionalProperties: false,
} as const;
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `npx vitest run lib/captions/prompt.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Implementar o cliente OpenRouter**

```typescript
// lib/captions/openrouter-client.ts
import { OpenRouter } from "@openrouter/sdk";
import { requireEnv } from "@/lib/ingestion/cron-auth";
import { buildCaptionMessages, CAPTION_JSON_SCHEMA, type CaptionPromptContext } from "./prompt";

export type CaptionContext = CaptionPromptContext;

export interface GeneratedCaption {
  headline: string;
  body: string;
}

export async function requestCaptionFromOpenRouter(context: CaptionContext): Promise<GeneratedCaption> {
  const client = new OpenRouter({ apiKey: requireEnv("OPENROUTER_API_KEY") });
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";

  const result = await client.chat.send({
    chatRequest: {
      model,
      messages: buildCaptionMessages(context),
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: "puzzle_records_caption", strict: true, schema: CAPTION_JSON_SCHEMA },
      },
      temperature: 0.7,
    },
  });

  if (!("choices" in result)) {
    throw new Error("OpenRouter retornou um stream inesperado (esperava resposta não-streaming)");
  }

  const content = result.choices[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter não retornou conteúdo de texto na resposta");
  }

  const parsed = JSON.parse(content) as Partial<GeneratedCaption>;
  if (!parsed.headline || !parsed.body) {
    throw new Error("Resposta da IA não contém headline/body válidos");
  }
  return { headline: parsed.headline, body: parsed.body };
}
```

Sem teste unitário direto para `requestCaptionFromOpenRouter` (chamada de rede real) — a lógica testável (prompt e schema) já está coberta no Step 1-4. A Tarefa 13 inclui um passo manual de QA que exercita essa função de ponta a ponta com a API key real.

- [ ] **Step 6: Adicionar as env vars ao `.env.example`**

```bash
# Fase 2 — Legenda (IA)
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
```

- [ ] **Step 7: Commit**

```bash
git add lib/captions .env.example
git commit -m "feat: prompt e cliente OpenRouter para geração de legenda estruturada"
```

---

### Task 5: Processor de legenda + wiring na ingestão

**Files:**
- Create: `lib/captions/generate-caption.ts`
- Modify: `lib/ingestion/google-drive.ts` (linha ~91, após `upsertPipelineItem`)
- Modify: `lib/ingestion/telegram.ts` (linha ~126, após `upsertPipelineItem`)

**Interfaces:**
- Consumes: `requestCaptionFromOpenRouter` (Tarefa 4), `logSystemAuditEvent` (Tarefa 2), `captionQueue`/`renderQueue` e `triggerQueueDrain` (Tarefa 1).
- Produces: `processCaptionJob(data: { pipelineItemId: string }): Promise<void>` — consumido por `app/api/queue/process/route.ts` (Tarefa 1, Step 7).

- [ ] **Step 1: Implementar o processor**

```typescript
// lib/captions/generate-caption.ts
import { createClient } from "@supabase/supabase-js";
import { requestCaptionFromOpenRouter } from "./openrouter-client";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";
import { renderQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface CaptionJobData {
  pipelineItemId: string;
}

/**
 * Idempotente: só processa itens ainda em "recebido" (evita reprocessar se o
 * mesmo job for drenado duas vezes por corrida entre cron e disparo
 * imediato). Falhas ficam registradas em caption_error e o item permanece
 * "recebido" — visível e reprocessável no Kanban, sem travar a fila
 * (critério de pronto da Fase 2 no PLAN.md).
 */
export async function processCaptionJob({ pipelineItemId }: CaptionJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, title, author, origin")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || item.status !== "recebido") return;

  try {
    const caption = await requestCaptionFromOpenRouter({
      title: item.title,
      author: item.author,
      origin: item.origin,
    });

    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "legenda",
        caption_headline: caption.headline,
        caption_body: caption.body,
        caption_generated_at: new Date().toISOString(),
        caption_error: null,
      })
      .eq("id", pipelineItemId);
    if (updateError) throw updateError;

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "recebido", to: "legenda" },
    });

    await renderQueue.add("render", { pipelineItemId });
    triggerQueueDrain();
  } catch (err) {
    console.error(`[caption] falha ao gerar legenda para ${pipelineItemId}:`, err);
    await supabase
      .from("pipeline_items")
      .update({ caption_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
  }
}
```

- [ ] **Step 2: Rodar o typecheck para confirmar que `app/api/queue/process/route.ts` (Tarefa 1) agora resolve o import**

Run: `npx tsc --noEmit`
Expected: sem erros relacionados a `processCaptionJob` (ainda faltam `processRenderJob`/`processPublishJob`, cobertos nas Tarefas 8 e 10)

- [ ] **Step 3: Ligar a ingestão do Drive à fila de legenda**

Em `lib/ingestion/google-drive.ts`, adicionar os imports no topo:

```typescript
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";
```

E trocar o bloco (linha ~91) de:

```typescript
      await upsertPipelineItem({
        origin: "drive",
        externalId: file.id!,
        title: file.name ?? null,
        author: file.owners?.[0]?.emailAddress ?? file.lastModifyingUser?.emailAddress ?? null,
        mimeType: file.mimeType ?? null,
        driveFileId: file.id!,
        metadata: {},
      });
      processed += 1;
```

para:

```typescript
      const result = await upsertPipelineItem({
        origin: "drive",
        externalId: file.id!,
        title: file.name ?? null,
        author: file.owners?.[0]?.emailAddress ?? file.lastModifyingUser?.emailAddress ?? null,
        mimeType: file.mimeType ?? null,
        driveFileId: file.id!,
        metadata: {},
      });
      if (result) {
        await captionQueue.add("caption", { pipelineItemId: result.id });
        triggerQueueDrain();
      }
      processed += 1;
```

- [ ] **Step 4: Ligar a ingestão do Telegram à fila de legenda**

Em `lib/ingestion/telegram.ts`, adicionar os imports no topo (junto aos já existentes):

```typescript
import { captionQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";
```

E trocar o bloco (linha ~126) de:

```typescript
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
```

para:

```typescript
    const result = await upsertPipelineItem({
      origin: "telegram",
      externalId: media.fileUniqueId,
      title: media.caption,
      author,
      mimeType: media.mimeType,
      storagePath,
      metadata: { chatId: ctx.chat?.id },
    });

    if (result) {
      await captionQueue.add("caption", { pipelineItemId: result.id });
      triggerQueueDrain();
    }

    await ctx.reply("Recebido! Já apareceu no Kanban em 'recebido'.");
```

- [ ] **Step 5: Rodar toda a suíte de testes existente para garantir que nada quebrou**

Run: `npm run test`
Expected: PASS em todos os testes de `lib/ingestion/*` (o mock de `captionQueue.add` não é exercitado pelos testes existentes, que testam só as funções puras — nenhum teste chama `syncDriveChanges`/`createTelegramBot` de ponta a ponta hoje)

- [ ] **Step 6: Commit**

```bash
git add lib/captions/generate-caption.ts lib/ingestion/google-drive.ts lib/ingestion/telegram.ts
git commit -m "feat: processor de geração de legenda + disparo automático a partir da ingestão"
```

---

### Task 6: Resolução de mídia para render (signed URL / Drive → Storage)

**Files:**
- Create: `lib/render/media.ts`

**Interfaces:**
- Produces: `resolveRenderableMediaUrl(item: PipelineItemMediaRef): Promise<string>` — usado pela Tarefa 8.
- Produces: `type PipelineItemMediaRef = { id: string; origin: "drive" | "telegram"; drive_file_id: string | null; storage_path: string | null; mime_type: string | null }`.

- [ ] **Step 1: Implementar**

```typescript
// lib/render/media.ts
import { createClient } from "@supabase/supabase-js";
import { getDriveClient } from "@/lib/ingestion/google-drive";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface PipelineItemMediaRef {
  id: string;
  origin: "drive" | "telegram";
  drive_file_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h — suficiente para o Creatomate buscar o arquivo durante o render

/**
 * Garante que o arquivo do item esteja no bucket raw-media e retorna uma URL
 * assinada, buscável pelo Creatomate. Itens do Drive ainda não têm o binário
 * baixado (a Fase 1 só registra metadados) — esta é a primeira etapa do
 * pipeline que efetivamente baixa o arquivo do Drive, e persiste o
 * storage_path de volta em pipeline_items para as próximas execuções.
 */
export async function resolveRenderableMediaUrl(item: PipelineItemMediaRef): Promise<string> {
  const supabase = getServiceRoleClient();
  let storagePath = item.storage_path;

  if (!storagePath) {
    if (item.origin !== "drive" || !item.drive_file_id) {
      throw new Error(`item ${item.id} não tem storage_path nem drive_file_id — sem mídia para renderizar`);
    }

    const drive = getDriveClient();
    const response = await drive.files.get(
      { fileId: item.drive_file_id, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const bytes = new Uint8Array(response.data as ArrayBuffer);
    const extension = (item.mime_type ?? "").startsWith("video") ? "mp4" : "jpg";
    storagePath = `drive/${item.drive_file_id}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("raw-media")
      .upload(storagePath, bytes, { contentType: item.mime_type ?? "application/octet-stream", upsert: true });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({ storage_path: storagePath })
      .eq("id", item.id);
    if (updateError) throw updateError;
  }

  const { data, error } = await supabase.storage.from("raw-media").createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw error ?? new Error("falha ao gerar signed URL");
  return data.signedUrl;
}
```

Sem teste unitário direto (I/O real com Drive API e Supabase Storage — mesma convenção do resto do código de integração externa no projeto). A Tarefa 13 cobre isso no QA manual.

- [ ] **Step 2: Commit**

```bash
git add lib/render/media.ts
git commit -m "feat: resolução de mídia renderizável (signed URL + download sob demanda do Drive)"
```

---

### Task 7: Cliente Creatomate + builder de modifications (Fase 3)

**Files:**
- Create: `lib/render/creatomate-client.ts`
- Create: `lib/render/modifications.ts`
- Create: `lib/render/modifications.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `startCreatomateRender(modifications: Record<string, string>, webhookUrl: string): Promise<{ id: string; status: string; url: string | null }>` — usado pela Tarefa 8.
- Produces: `buildCreatomateModifications(caption: { headline: string; body: string }, media: { photo1Url: string; photo2Url?: string }): Record<string, string>` — usado pela Tarefa 8.

**Pendência manual (fora deste plano de código):** o template ainda não existe no editor visual do Creatomate. Antes de rodar o smoke test (Tarefa 8) contra a API de verdade, o usuário precisa: (1) desenhar o template seguindo a linguagem de design do PRD §6 (manchete, foto dupla, selo AGORA/IMPACTO, card de perfil do Instagram); (2) anotar o `template_id` e os nomes das camadas de texto/imagem; (3) preencher `CREATOMATE_TEMPLATE_ID`, `CREATOMATE_LAYER_HEADLINE`, `CREATOMATE_LAYER_PHOTO_1`, `CREATOMATE_LAYER_PHOTO_2` (opcional) e `CREATOMATE_LAYER_BADGE` (opcional) no `.env.local`/Vercel.

- [ ] **Step 1: Escrever o teste do builder de modifications (falha esperada)**

```typescript
// lib/render/modifications.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCreatomateModifications } from "./modifications";

describe("buildCreatomateModifications", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.CREATOMATE_LAYER_HEADLINE = "Headline";
    process.env.CREATOMATE_LAYER_PHOTO_1 = "Photo-1";
    process.env.CREATOMATE_LAYER_PHOTO_2 = "Photo-2";
    process.env.CREATOMATE_LAYER_BADGE = "Badge";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("mapeia headline, foto 1 e badge para os nomes de camada configurados", () => {
    const modifications = buildCreatomateModifications(
      { headline: "ELE VOLTOU!", body: "legenda" },
      { photo1Url: "https://example.com/foto1.jpg" },
    );
    expect(modifications).toEqual({
      Headline: "ELE VOLTOU!",
      "Photo-1": "https://example.com/foto1.jpg",
      "Photo-2": "https://example.com/foto1.jpg", // sem segunda foto disponível -> reusa a primeira
      Badge: "AGORA",
    });
  });

  it("usa a segunda foto quando fornecida", () => {
    const modifications = buildCreatomateModifications(
      { headline: "x", body: "y" },
      { photo1Url: "https://example.com/1.jpg", photo2Url: "https://example.com/2.jpg" },
    );
    expect(modifications["Photo-2"]).toBe("https://example.com/2.jpg");
  });

  it("omite camadas cujo nome não está configurado via env", () => {
    delete process.env.CREATOMATE_LAYER_BADGE;
    const modifications = buildCreatomateModifications({ headline: "x", body: "y" }, { photo1Url: "https://example.com/1.jpg" });
    expect(modifications).not.toHaveProperty("Badge");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/render/modifications.test.ts`
Expected: FAIL com "Cannot find module './modifications'"

- [ ] **Step 3: Implementar o builder**

```typescript
// lib/render/modifications.ts
export interface CaptionForRender {
  headline: string;
  body: string;
}

export interface RenderMediaUrls {
  photo1Url: string;
  photo2Url?: string;
}

/**
 * Nomes de camada configuráveis via env var em vez de hardcoded, porque o
 * template do Creatomate ainda não existe — quando o usuário desenhar o
 * template de verdade, os nomes reais entram só na env, sem mexer no código.
 * MVP simplificado: quando só há uma foto disponível, a segunda camada de
 * foto reusa a mesma URL (o material bruto da Fase 1 ainda é um único
 * arquivo por item — "foto dupla" de verdade fica para quando o pipeline
 * suportar múltiplos arquivos por item).
 */
export function buildCreatomateModifications(caption: CaptionForRender, media: RenderMediaUrls): Record<string, string> {
  const modifications: Record<string, string> = {};

  const headlineLayer = process.env.CREATOMATE_LAYER_HEADLINE;
  const photo1Layer = process.env.CREATOMATE_LAYER_PHOTO_1;
  const photo2Layer = process.env.CREATOMATE_LAYER_PHOTO_2;
  const badgeLayer = process.env.CREATOMATE_LAYER_BADGE;

  if (headlineLayer) modifications[headlineLayer] = caption.headline;
  if (photo1Layer) modifications[photo1Layer] = media.photo1Url;
  if (photo2Layer) modifications[photo2Layer] = media.photo2Url ?? media.photo1Url;
  if (badgeLayer) modifications[badgeLayer] = "AGORA";

  return modifications;
}
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `npx vitest run lib/render/modifications.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Implementar o cliente Creatomate**

```typescript
// lib/render/creatomate-client.ts
import { requireEnv } from "@/lib/ingestion/cron-auth";

const CREATOMATE_API_BASE = "https://api.creatomate.com/v1";

export interface CreatomateRenderResult {
  id: string;
  status: string;
  url: string | null;
}

export async function startCreatomateRender(
  modifications: Record<string, string>,
  webhookUrl: string,
): Promise<CreatomateRenderResult> {
  const apiKey = requireEnv("CREATOMATE_API_KEY");
  const templateId = requireEnv("CREATOMATE_TEMPLATE_ID");

  const response = await fetch(`${CREATOMATE_API_BASE}/renders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      modifications,
      webhook_url: webhookUrl,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Creatomate render falhou (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as CreatomateRenderResult[];
  const render = payload[0];
  if (!render) throw new Error("Creatomate não retornou nenhum render na resposta");
  return render;
}
```

- [ ] **Step 6: Adicionar as env vars ao `.env.example`**

```bash
# Fase 3 — Render (Creatomate)
CREATOMATE_API_KEY=
CREATOMATE_TEMPLATE_ID=
CREATOMATE_WEBHOOK_SECRET=
CREATOMATE_LAYER_HEADLINE=
CREATOMATE_LAYER_PHOTO_1=
CREATOMATE_LAYER_PHOTO_2=
CREATOMATE_LAYER_BADGE=
```

- [ ] **Step 7: Commit**

```bash
git add lib/render/creatomate-client.ts lib/render/modifications.ts lib/render/modifications.test.ts .env.example
git commit -m "feat: cliente Creatomate e builder de modifications configurável por env"
```

---

### Task 8: Processor de render + webhook de conclusão + smoke test

**Files:**
- Create: `lib/render/generate-render.ts`
- Create: `app/api/creatomate/webhook/route.ts`
- Create: `scripts/creatomate-smoke-test.ts`
- Modify: `package.json` (novo script)

**Interfaces:**
- Consumes: `resolveRenderableMediaUrl` (Tarefa 6), `startCreatomateRender`/`buildCreatomateModifications` (Tarefa 7), `logSystemAuditEvent` (Tarefa 2), `publishQueue`/`triggerQueueDrain` (Tarefa 1).
- Produces: `processRenderJob(data: { pipelineItemId: string }): Promise<void>` — consumido por `app/api/queue/process/route.ts` (Tarefa 1).

- [ ] **Step 1: Implementar o processor de render**

```typescript
// lib/render/generate-render.ts
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/ingestion/cron-auth";
import { resolveRenderableMediaUrl } from "./media";
import { startCreatomateRender } from "./creatomate-client";
import { buildCreatomateModifications } from "./modifications";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface RenderJobData {
  pipelineItemId: string;
}

export async function processRenderJob({ pipelineItemId }: RenderJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, origin, drive_file_id, storage_path, mime_type, caption_headline, caption_body")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || item.status !== "legenda" || !item.caption_headline || !item.caption_body) return;

  try {
    const mediaUrl = await resolveRenderableMediaUrl(item);
    const modifications = buildCreatomateModifications(
      { headline: item.caption_headline, body: item.caption_body },
      { photo1Url: mediaUrl },
    );
    const webhookUrl = `${requireEnv("PUBLIC_BASE_URL")}/api/creatomate/webhook?token=${requireEnv("CREATOMATE_WEBHOOK_SECRET")}&item=${pipelineItemId}`;
    const render = await startCreatomateRender(modifications, webhookUrl);

    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "renderizando",
        render_id: render.id,
        render_started_at: new Date().toISOString(),
        render_error: null,
      })
      .eq("id", pipelineItemId);
    if (updateError) throw updateError;

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "legenda", to: "renderizando" },
    });
  } catch (err) {
    console.error(`[render] falha ao iniciar render para ${pipelineItemId}:`, err);
    await supabase
      .from("pipeline_items")
      .update({ render_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
  }
}
```

- [ ] **Step 2: Implementar o webhook de conclusão do Creatomate**

```typescript
// app/api/creatomate/webhook/route.ts
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/ingestion/cron-auth";
import { publishQueue } from "@/workers/queues";
import { triggerQueueDrain } from "@/lib/queue/trigger";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";

export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const itemId = request.nextUrl.searchParams.get("item");
  const expectedToken = requireEnv("CREATOMATE_WEBHOOK_SECRET");
  if (!safeCompare(token, expectedToken) || !itemId) {
    return NextResponse.json({ error: "invalid webhook" }, { status: 401 });
  }

  const payload = (await request.json()) as { status?: string; url?: string; error_message?: string };
  const supabase = getServiceRoleClient();

  if (payload.status === "succeeded" && payload.url) {
    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({ render_url: payload.url, render_error: null })
      .eq("id", itemId);
    if (updateError) {
      console.error("[creatomate/webhook] falha ao salvar render_url", updateError);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    await logSystemAuditEvent({ action: "render_completed", entityId: itemId, metadata: { url: payload.url } });

    // Gate de aprovação (Fase 4) foi deliberadamente pulado nesta versão de
    // teste — publicação dispara automaticamente ao terminar o render. Ver
    // "Global Constraints" no topo deste plano.
    await publishQueue.add("publish", { pipelineItemId: itemId });
    triggerQueueDrain();
  } else if (payload.status === "failed") {
    await supabase
      .from("pipeline_items")
      .update({ render_error: payload.error_message ?? "render falhou no Creatomate" })
      .eq("id", itemId);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Criar o script de smoke test**

```typescript
// scripts/creatomate-smoke-test.ts
//
// Roda um render de teste contra o CREATOMATE_TEMPLATE_ID configurado, para
// validar uma troca de versão de template antes de ir para produção (regra
// do CLAUDE.md: "nunca trocar a versão em produção sem rodar o smoke test
// automático primeiro"). Uso: npm run creatomate:smoke-test
import "dotenv/config";
import { startCreatomateRender } from "../lib/render/creatomate-client";
import { buildCreatomateModifications } from "../lib/render/modifications";

async function main() {
  const modifications = buildCreatomateModifications(
    { headline: "SMOKE TEST — ignorar", body: "Render de validação automática do template." },
    { photo1Url: "https://placehold.co/1080x1920.png" },
  );

  const render = await startCreatomateRender(modifications, "https://example.com/smoke-test-no-webhook");

  console.log(`[smoke-test] render iniciado: id=${render.id} status=${render.status}`);
  if (!render.id) {
    console.error("[smoke-test] FALHOU — resposta sem id de render");
    process.exit(1);
  }
  console.log("[smoke-test] OK — template aceitou o payload. Confira o resultado no dashboard do Creatomate.");
}

main().catch((err) => {
  console.error("[smoke-test] FALHOU:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Adicionar o script ao `package.json`**

```json
    "creatomate:smoke-test": "tsx scripts/creatomate-smoke-test.ts"
```

(adicionar essa linha dentro do bloco `"scripts"`, junto às demais)

- [ ] **Step 5: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros relacionados a `processRenderJob` no import de `app/api/queue/process/route.ts` (ainda falta `processPublishJob`, coberto na Tarefa 10)

- [ ] **Step 6: Commit**

```bash
git add lib/render/generate-render.ts app/api/creatomate/webhook scripts/creatomate-smoke-test.ts package.json
git commit -m "feat: processor de render, webhook de conclusão do Creatomate e smoke test de template"
```

---

### Task 9: Cliente Zernio — interface + mock + stub real (Fase 5)

**Files:**
- Create: `lib/publishing/zernio-client.ts`
- Create: `lib/publishing/mock-zernio-client.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `interface ZernioClient { publish(input: ZernioPublishInput): Promise<ZernioPublishResult>; getAnalytics(postId: string): Promise<ZernioAnalytics> }` — usado pelas Tarefas 10 e 12.
- Produces: `getZernioClient(): ZernioClient` — usado pelas Tarefas 10 e 12.

**Nota importante:** a API real do Zernio não é conhecida (não está no treinamento do modelo, e a documentação ainda não foi fornecida pelo usuário — ele confirmou que vai passá-la depois que o desenvolvimento terminar). Por isso este cliente usa por padrão um **mock** que simula a publicação e loga o que faria — o resto do pipeline (Kanban, auditoria, calendário, analytics) fica de ponta a ponta funcional e testável com esse mock. A publicação real no Instagram só passa a acontecer quando `RealZernioClient` for implementado com a API de verdade (tarefa de acompanhamento fora deste plano, assim que o usuário fornecer a documentação).

- [ ] **Step 1: Implementar a interface + o mock**

```typescript
// lib/publishing/zernio-client.ts
import { getMockZernioClient } from "./mock-zernio-client";

export interface ZernioPublishInput {
  instagramAccountId: string;
  videoUrl: string;
  captionText: string;
}

export interface ZernioPublishResult {
  postId: string;
  permalink: string | null;
  publishedAtUtc: string;
}

export interface ZernioAnalytics {
  reach: number;
  engagement: number;
  impressions: number;
}

export interface ZernioClient {
  publish(input: ZernioPublishInput): Promise<ZernioPublishResult>;
  getAnalytics(postId: string): Promise<ZernioAnalytics>;
}

/**
 * Stub fail-closed: a API real do Zernio ainda não foi documentada pelo
 * usuário. Em vez de adivinhar endpoints, este cliente falha alto e aponta
 * para onde implementar — mesmo espírito do requireEnv() já usado no
 * projeto (falhar de forma óbvia em vez de silenciosa).
 */
class RealZernioClient implements ZernioClient {
  async publish(): Promise<ZernioPublishResult> {
    throw new Error(
      "RealZernioClient ainda não implementado — falta a documentação real da API do Zernio " +
        "(ver Task 9 de docs/superpowers/plans/2026-09-17-fase-2-3-5-pipeline-completo.md).",
    );
  }

  async getAnalytics(): Promise<ZernioAnalytics> {
    throw new Error("RealZernioClient ainda não implementado — falta a documentação real da API do Zernio.");
  }
}

export function getZernioClient(): ZernioClient {
  if (process.env.ZERNIO_API_KEY) {
    return new RealZernioClient();
  }
  return getMockZernioClient();
}
```

```typescript
// lib/publishing/mock-zernio-client.ts
import type { ZernioClient, ZernioPublishInput, ZernioPublishResult, ZernioAnalytics } from "./zernio-client";

export function getMockZernioClient(): ZernioClient {
  return {
    async publish(input: ZernioPublishInput): Promise<ZernioPublishResult> {
      console.log(
        `[zernio:mock] publicaria no Instagram (conta ${input.instagramAccountId}): "${input.captionText.slice(0, 80)}..." — vídeo: ${input.videoUrl}`,
      );
      return {
        postId: `mock-${Date.now()}`,
        permalink: null,
        publishedAtUtc: new Date().toISOString(),
      };
    },

    async getAnalytics(): Promise<ZernioAnalytics> {
      return { reach: 0, engagement: 0, impressions: 0 };
    },
  };
}
```

- [ ] **Step 2: Adicionar as env vars ao `.env.example`**

```bash
# Fase 5 — Publicação (Zernio) — sem ZERNIO_API_KEY, o pipeline usa o mock
ZERNIO_API_KEY=
ZERNIO_API_BASE_URL=
ZERNIO_INSTAGRAM_ACCOUNT_ID=
```

- [ ] **Step 3: Commit**

```bash
git add lib/publishing/zernio-client.ts lib/publishing/mock-zernio-client.ts .env.example
git commit -m "feat: interface ZernioClient com mock funcional e stub fail-closed para a API real"
```

---

### Task 10: Processor de publicação (Fase 5 — núcleo)

**Files:**
- Create: `lib/publishing/publish-post.ts`

**Interfaces:**
- Consumes: `getZernioClient` (Tarefa 9), `logSystemAuditEvent` (Tarefa 2).
- Produces: `processPublishJob(data: { pipelineItemId: string }): Promise<void>` — consumido por `app/api/queue/process/route.ts` (Tarefa 1).

- [ ] **Step 1: Implementar**

```typescript
// lib/publishing/publish-post.ts
import { createClient } from "@supabase/supabase-js";
import { getZernioClient } from "./zernio-client";
import { logSystemAuditEvent } from "@/lib/audit/log-system-event";

function getServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export interface PublishJobData {
  pipelineItemId: string;
}

export async function processPublishJob({ pipelineItemId }: PublishJobData): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: item, error } = await supabase
    .from("pipeline_items")
    .select("id, status, render_url, caption_headline, caption_body")
    .eq("id", pipelineItemId)
    .maybeSingle();
  if (error) throw error;
  if (!item || !item.render_url || item.status === "publicado") return;

  try {
    const client = getZernioClient();
    const result = await client.publish({
      instagramAccountId: process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID ?? "",
      videoUrl: item.render_url,
      captionText: `${item.caption_headline}\n\n${item.caption_body}`,
    });

    const { error: updateError } = await supabase
      .from("pipeline_items")
      .update({
        status: "publicado",
        published_at: result.publishedAtUtc,
        publish_post_id: result.postId,
        publish_permalink: result.permalink,
        publish_error: null,
      })
      .eq("id", pipelineItemId);
    if (updateError) throw updateError;

    await logSystemAuditEvent({
      action: "status_changed",
      entityId: pipelineItemId,
      metadata: { from: "renderizando", to: "publicado", postId: result.postId },
    });
  } catch (err) {
    console.error(`[publish] falha ao publicar ${pipelineItemId}:`, err);
    await supabase
      .from("pipeline_items")
      .update({ publish_error: err instanceof Error ? err.message : String(err) })
      .eq("id", pipelineItemId);
  }
}
```

- [ ] **Step 2: Rodar o typecheck do projeto inteiro — agora todas as três filas do endpoint de drain resolvem**

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Rodar a suíte de testes inteira**

Run: `npm run test`
Expected: PASS em todos os testes (Fase 1 + os novos das Tarefas 1, 3, 4 e 7)

- [ ] **Step 4: Commit**

```bash
git add lib/publishing/publish-post.ts
git commit -m "feat: processor de publicação imediata no Zernio (Fase 5 - núcleo)"
```

---

### Task 11: Kanban — exibir legenda, render e publicação (com erros visíveis)

**Files:**
- Modify: `lib/ingestion/pipeline-items.ts` (`PipelineItemRow` + query de `getPipelineItemsGroupedByStatus`)
- Modify: `app/dashboard/kanban/page.tsx`

**Interfaces:**
- Consumes: nenhuma nova — só amplia o que `getPipelineItemsGroupedByStatus` já produzia (Fase 1).
- Produces: `PipelineItemRow` ganha os campos `caption_headline`, `render_url`, `published_at`, `publish_permalink`, `publish_post_id`, `caption_error`, `render_error`, `publish_error` — consumidos pela Tarefa 12 (calendário/analytics).

- [ ] **Step 1: Ampliar `PipelineItemRow` e a query**

Em `lib/ingestion/pipeline-items.ts`, trocar:

```typescript
export interface PipelineItemRow {
  id: string;
  origin: PipelineItemOrigin;
  status: string;
  title: string | null;
  author: string | null;
  created_at: string;
}
```

por:

```typescript
export interface PipelineItemRow {
  id: string;
  origin: PipelineItemOrigin;
  status: string;
  title: string | null;
  author: string | null;
  created_at: string;
  caption_headline: string | null;
  caption_error: string | null;
  render_url: string | null;
  render_error: string | null;
  published_at: string | null;
  publish_post_id: string | null;
  publish_permalink: string | null;
  publish_error: string | null;
}
```

E trocar a chamada `.select(...)` dentro de `getPipelineItemsGroupedByStatus`:

```typescript
    .select("id, origin, status, title, author, created_at")
```

por:

```typescript
    .select(
      "id, origin, status, title, author, created_at, caption_headline, caption_error, render_url, render_error, published_at, publish_post_id, publish_permalink, publish_error",
    )
```

- [ ] **Step 2: Atualizar o card do Kanban**

Em `app/dashboard/kanban/page.tsx`, trocar o bloco do card:

```tsx
            {grouped[status].map((item) => (
              <div key={item.id} className="rounded-md border bg-background p-2 text-sm">
                <p className="font-medium">{item.title ?? "(sem título)"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.origin === "drive" ? "Drive" : "Telegram"} · {item.author ?? "autor desconhecido"}
                </p>
              </div>
            ))}
```

por:

```tsx
            {grouped[status].map((item) => (
              <div key={item.id} className="rounded-md border bg-background p-2 text-sm">
                <p className="font-medium">{item.caption_headline ?? item.title ?? "(sem título)"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.origin === "drive" ? "Drive" : "Telegram"} · {item.author ?? "autor desconhecido"}
                </p>
                {item.render_url && (
                  <a href={item.render_url} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-blue-600 underline">
                    ver vídeo renderizado
                  </a>
                )}
                {item.publish_permalink && (
                  <a href={item.publish_permalink} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-green-600 underline">
                    ver post publicado
                  </a>
                )}
                {(item.caption_error || item.render_error || item.publish_error) && (
                  <p className="mt-1 text-xs text-red-600">
                    erro: {item.caption_error ?? item.render_error ?? item.publish_error}
                  </p>
                )}
              </div>
            ))}
```

- [ ] **Step 3: Rodar o typecheck e os testes**

Run: `npx tsc --noEmit && npm run test`
Expected: sem erros, todos os testes PASS

- [ ] **Step 4: Commit**

```bash
git add lib/ingestion/pipeline-items.ts app/dashboard/kanban/page.tsx
git commit -m "feat: Kanban exibe legenda, link de render, link de publicação e erros por etapa"
```

---

### Task 12: Dashboard mínimo — Início, Calendário e Analytics (Fase 5 MVP)

**Files:**
- Modify: `app/dashboard/page.tsx`
- Create: `app/dashboard/calendario/page.tsx`
- Create: `app/dashboard/analytics/page.tsx`
- Modify: `components/layout/sidebar.tsx`

**Interfaces:**
- Consumes: `getPipelineItemsGroupedByStatus`/`PIPELINE_STATUSES` (Fase 1, ampliado na Tarefa 11), `formatUtcAsSaoPaulo` (Tarefa 3), `getZernioClient` (Tarefa 9).

- [ ] **Step 1: Substituir o placeholder da Início por contagem por status**

```tsx
// app/dashboard/page.tsx
import { getPipelineItemsGroupedByStatus, PIPELINE_STATUSES } from "@/lib/ingestion/pipeline-items";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  recebido: "Recebido",
  legenda: "Legenda",
  renderizando: "Renderizando",
  aguardando_aprovacao: "Aguardando aprovação",
  agendado: "Agendado",
  publicado: "Publicado",
};

export default async function DashboardPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const total = PIPELINE_STATUSES.reduce((sum, status) => sum + grouped[status].length, 0);

  if (total === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Nenhum item no pipeline ainda</h1>
        <p className="mt-2 text-sm text-muted-foreground">Suba um material pelo Drive ou pelo Telegram para começar.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-6">
      {PIPELINE_STATUSES.map((status) => (
        <div key={status} className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
          <p className="mt-1 text-2xl font-semibold">{grouped[status].length}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Criar a página de calendário editorial**

```tsx
// app/dashboard/calendario/page.tsx
import { getPipelineItemsGroupedByStatus } from "@/lib/ingestion/pipeline-items";
import { formatUtcAsSaoPaulo } from "@/lib/time/timezone";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const published = grouped.publicado;

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Calendário editorial</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Horários convertidos de UTC (retorno do Zernio) para America/Sao_Paulo.
      </p>
      <div className="space-y-2">
        {published.length === 0 && <p className="text-sm text-muted-foreground">Nenhum post publicado ainda.</p>}
        {published.map((item) => (
          <div key={item.id} className="rounded-md border p-3 text-sm">
            <p className="font-medium">{item.caption_headline ?? item.title ?? "(sem título)"}</p>
            <p className="text-xs text-muted-foreground">
              {item.published_at ? formatUtcAsSaoPaulo(item.published_at) : "sem data"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar a página de analytics**

```tsx
// app/dashboard/analytics/page.tsx
import { getPipelineItemsGroupedByStatus } from "@/lib/ingestion/pipeline-items";
import { getZernioClient } from "@/lib/publishing/zernio-client";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const grouped = await getPipelineItemsGroupedByStatus();
  const published = grouped.publicado;
  const client = getZernioClient();

  const rows = await Promise.all(
    published.map(async (item) => ({
      item,
      analytics: item.publish_post_id ? await client.getAnalytics(item.publish_post_id) : null,
    })),
  );

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Analytics</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2">Post</th>
            <th className="pb-2">Alcance</th>
            <th className="pb-2">Engajamento</th>
            <th className="pb-2">Impressões</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, analytics }) => (
            <tr key={item.id} className="border-t">
              <td className="py-2">{item.caption_headline ?? item.title ?? "(sem título)"}</td>
              <td className="py-2">{analytics?.reach ?? "—"}</td>
              <td className="py-2">{analytics?.engagement ?? "—"}</td>
              <td className="py-2">{analytics?.impressions ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Adicionar os itens de navegação**

Em `components/layout/sidebar.tsx`, trocar:

```typescript
const NAV_ITEMS: { href: string; label: string; roles: UserRole[] }[] = [
  { href: "/dashboard", label: "Início", roles: ["equipe_conteudo", "editorial", "admin"] },
  { href: "/dashboard/kanban", label: "Kanban", roles: ["equipe_conteudo", "editorial", "admin"] },
  { href: "/dashboard/aprovacoes", label: "Aprovações", roles: ["editorial", "admin"] },
  { href: "/dashboard/configuracoes", label: "Configurações", roles: ["admin"] },
];
```

por:

```typescript
const NAV_ITEMS: { href: string; label: string; roles: UserRole[] }[] = [
  { href: "/dashboard", label: "Início", roles: ["equipe_conteudo", "editorial", "admin"] },
  { href: "/dashboard/kanban", label: "Kanban", roles: ["equipe_conteudo", "editorial", "admin"] },
  { href: "/dashboard/calendario", label: "Calendário", roles: ["editorial", "admin"] },
  { href: "/dashboard/analytics", label: "Analytics", roles: ["editorial", "admin"] },
  { href: "/dashboard/aprovacoes", label: "Aprovações", roles: ["editorial", "admin"] },
  { href: "/dashboard/configuracoes", label: "Configurações", roles: ["admin"] },
];
```

- [ ] **Step 5: Rodar o typecheck, o lint e os testes**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: sem erros, todos os testes PASS

- [ ] **Step 6: Commit**

```bash
git add app/dashboard components/layout/sidebar.tsx
git commit -m "feat: dashboard Início (contagem por status), calendário editorial e analytics (MVP)"
```

---

### Task 13: Consolidação final — env vars, docs e checklist de QA end-to-end

**Files:**
- Modify: `.env.example` (conferência final — nenhum código novo, só checklist)
- Modify: `.docs/PLAN.md`

**Interfaces:** nenhuma — tarefa de fechamento.

- [ ] **Step 1: Conferir que `.env.example` tem todas as vars introduzidas nas Tarefas 4, 7 e 9**

Checklist (todas já devem estar lá pelos steps anteriores — este passo é só a verificação final):
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `CREATOMATE_API_KEY`, `CREATOMATE_TEMPLATE_ID`, `CREATOMATE_WEBHOOK_SECRET`, `CREATOMATE_LAYER_HEADLINE`, `CREATOMATE_LAYER_PHOTO_1`, `CREATOMATE_LAYER_PHOTO_2`, `CREATOMATE_LAYER_BADGE`
- `ZERNIO_API_KEY`, `ZERNIO_API_BASE_URL`, `ZERNIO_INSTAGRAM_ACCOUNT_ID`

- [ ] **Step 2: Atualizar `.docs/PLAN.md`**

Substituir a seção "Fase 2 — Geração de legenda (IA)" (e as seções Fase 3/Fase 5 correspondentes) por um status igual ao padrão já usado nas Fases 0/1: código implementado, quais bugs/pendências restam, e registrar explicitamente:
1. Gate de aprovação (Fase 4) foi pulado por decisão do usuário nesta versão de teste — pendência para uma iteração futura antes de uso real em produção.
2. `RealZernioClient` continua como stub até a API real ser documentada — publicação real no Instagram só ativa depois disso.
3. Template do Creatomate precisa ser criado manualmente antes do smoke test rodar contra a API de verdade.
4. Relatórios/exportação e busca/filtros completos do dashboard (Fase 5 do PRD) ficam fora deste plano — pendência futura.
5. A migration `00000000000003_add_caption_render_publish.sql` ainda precisa ser aplicada manualmente no Supabase Studio, junto das migrations 1 e 2 já pendentes.

- [ ] **Step 3: Checklist de QA manual end-to-end (executar depois que todas as credenciais reais estiverem configuradas)**

1. Aplicar as 3 migrations pendentes no Supabase Studio (audit_log, pipeline_items, colunas novas desta fase).
2. Preencher `OPENROUTER_API_KEY` real.
3. Criar o template no Creatomate, preencher `CREATOMATE_API_KEY`/`CREATOMATE_TEMPLATE_ID`/nomes de camada, rodar `npm run creatomate:smoke-test` e confirmar sucesso.
4. Deixar `ZERNIO_API_KEY` **vazio** propositalmente nesta primeira rodada (usa o mock) — subir uma foto de teste pelo Telegram e acompanhar no Kanban: `recebido` → `legenda` → `renderizando` → `publicado`, checando os logs do endpoint `/api/queue/process` e o console (`[zernio:mock] publicaria...`).
5. Confirmar no Supabase que `audit_log` recebeu uma linha para cada transição de status do item de teste.
6. Assim que o usuário fornecer a documentação real do Zernio: implementar `RealZernioClient` (fora deste plano), preencher `ZERNIO_API_KEY`/`ZERNIO_API_BASE_URL`/`ZERNIO_INSTAGRAM_ACCOUNT_ID`, repetir o teste de ponta a ponta e confirmar que o post aparece de verdade no Instagram.

- [ ] **Step 4: Commit**

```bash
git add .docs/PLAN.md .env.example
git commit -m "docs: fecha Fase 2/3/5 (MVP) no PLAN.md e registra checklist de QA end-to-end"
```
