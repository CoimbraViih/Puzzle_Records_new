# Fase 0 — Fundação — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ter um esqueleto do Puzzle Records rodando em produção na Vercel — Next.js + Supabase (auth + papéis) + estrutura de fila Redis/BullMQ — com um usuário conseguindo logar, ver um dashboard vazio, e permissões por papel bloqueando/liberando telas.

**Architecture:** Monorepo simples (um único `package.json` na raiz). Next.js App Router com Server Components por padrão; Client Components só onde há interatividade (formulário de login, sidebar). Supabase Auth (e-mail+senha) via `@supabase/ssr`, com `middleware.ts` fazendo refresh de sessão e protegendo rotas. Papéis (`operador`, `aprovador`, `gestor`) vivem em `public.profiles`, atribuídos manualmente no banco nesta fase. Pasta `/workers` isolada para os jobs BullMQ das próximas fases (nenhum job real ainda), conectando a um Redis gerenciado pela Upstash.

**Tech Stack:** Next.js (App Router) + TypeScript, Tailwind CSS, shadcn/ui, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), BullMQ + ioredis, Vitest (testes unitários de lógica pura), Vercel (deploy), Upstash Redis.

**Pré-requisitos que o humano precisa ter em mãos antes de começar:**
- Credenciais do projeto Supabase existente: Project URL, `anon` key, `service_role` key (Settings → API).
- Acesso ao repositório GitHub vazio: `https://github.com/CoimbraViih/Puzzle_Records_new`.
- Acesso ao time Vercel: `https://vercel.com/viihcoimbra7x-9058s-projects`.
- Uma conta Upstash (ou Redis já provisionado) com a connection string (`rediss://...`).

---

## Task 1: Inicializar repositório Git e conectar ao remoto

**Files:**
- Create: `.gitignore`
- Create: `README.md`

**Step 1: Verificar que não há git init e inicializar**

Run: `git status`
Expected: `fatal: not a git repository...`

Run:
```bash
git init
git branch -M main
```

**Step 2: Criar `.gitignore`**

```gitignore
# dependencies
node_modules/
.pnp
.pnp.js

# next.js
.next/
out/
build/

# env
.env
.env.local
.env*.local

# misc
.DS_Store
*.pem
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# typescript
*.tsbuildinfo
next-env.d.ts

# vercel
.vercel
```

**Step 3: Criar README mínimo**

```markdown
# Puzzle Records — Social Automation

Pipeline de automação de posts de Instagram (ingestão → legenda IA → render → aprovação → publicação).

Ver `.docs/PRD.md` e `.docs/PLAN.md` para contexto completo e roadmap.
```

**Step 4: Conectar ao remoto e primeiro commit**

```bash
git remote add origin https://github.com/CoimbraViih/Puzzle_Records_new.git
git add .gitignore README.md .docs Skills_Puzzle_Records.md
git commit -m "chore: initial commit with docs"
git push -u origin main
```

Expected: push cria a branch `main` no remoto vazio sem conflitos.

---

## Task 2: Scaffold do Next.js com TypeScript e Tailwind

**Files:**
- Create: projeto Next.js completo na raiz (`app/`, `public/`, `next.config.ts`, `tsconfig.json`, etc.)

**Step 1: Rodar o scaffold oficial na raiz do repo**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm
```

Quando perguntar se a pasta não está vazia (por causa de `.docs`, `.git`, `README.md`), confirme para continuar (`y`).

Expected: gera `app/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind` já configurado via `app/globals.css` (Tailwind v4 usa `@import "tailwindcss"` direto no CSS, sem `tailwind.config.js` obrigatório).

**Step 2: Rodar o dev server para confirmar que o scaffold funciona**

Run: `npm run dev`
Expected: servidor sobe em `http://localhost:3000` mostrando a página padrão do Next.js. Pare o servidor (Ctrl+C) depois de confirmar.

**Step 3: Limpar o boilerplate da página inicial**

Edit `app/page.tsx` para um placeholder simples:

```tsx
export default function Home() {
  return null;
}
```

(Essa rota será substituída por lógica de redirecionamento na Task 11.)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with TypeScript and Tailwind"
```

---

## Task 3: Inicializar shadcn/ui e instalar componentes base

**Files:**
- Create: `components.json`
- Create: `components/ui/*` (gerado pelo CLI)
- Create: `lib/utils.ts` (gerado pelo CLI)

**Step 1: Inicializar shadcn/ui**

Run: `npx shadcn@latest init`

Responda ao wizard: estilo "Default", cor base "Neutral", CSS variables "yes".

Expected: cria `components.json` e `lib/utils.ts` (helper `cn`).

**Step 2: Instalar os componentes que serão usados nesta fase**

Run:
```bash
npx shadcn@latest add button input label card avatar separator dropdown-menu sheet skeleton
```

Expected: cria arquivos em `components/ui/` (button.tsx, input.tsx, etc.) sem erros.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: initialize shadcn/ui with base components"
```

---

## Task 4: Configurar variáveis de ambiente

**Files:**
- Create: `.env.example`
- Create: `.env.local` (não versionado — já coberto pelo `.gitignore`)

**Step 1: Criar `.env.example`**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Redis (Upstash) — usado pela fila BullMQ em /workers
REDIS_URL=
```

**Step 2: Criar `.env.local` com os valores reais**

Peça ao usuário (fora deste plano, interativamente) a Project URL, `anon key` e `service_role key` do projeto Supabase existente (Settings → API no dashboard Supabase), e a connection string do Redis Upstash. Preencha `.env.local` com esses valores — este arquivo nunca é commitado.

**Step 3: Commit apenas o exemplo**

```bash
git add .env.example
git commit -m "chore: add environment variable template"
```

---

## Task 5: Migration SQL do Supabase (profiles, audit_log, RLS)

**Files:**
- Create: `supabase/migrations/00000000000001_init_profiles_and_audit.sql`

**Step 1: Escrever a migration**

```sql
-- supabase/migrations/00000000000001_init_profiles_and_audit.sql

create type public.user_role as enum ('operador', 'aprovador', 'gestor');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'operador',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own_non_role_fields"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles where id = auth.uid()));

create policy "profiles_gestor_full_access"
  on public.profiles for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'gestor')
  );

-- cria profile automaticamente quando um usuário se registra no Supabase Auth
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- auditoria genérica, reaproveitada pelas próximas fases
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy "audit_log_gestor_read"
  on public.audit_log for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'gestor')
  );

create policy "audit_log_authenticated_insert"
  on public.audit_log for insert
  with check (auth.uid() = actor_id);
```

**Step 2: Aplicar a migration no projeto Supabase existente**

Se o Supabase CLI estiver disponível e linkado ao projeto:
```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

Alternativa (sem CLI): colar o conteúdo do arquivo no SQL Editor do Supabase Studio e executar.

Expected: tabelas `profiles` e `audit_log` aparecem em Database → Tables, com RLS habilitada (ícone de cadeado).

**Step 3: Promover o primeiro usuário gestor manualmente**

Depois de criar seu próprio usuário via tela de login (Task 9) ou via Supabase Studio → Authentication → Add user, rode no SQL Editor:
```sql
update public.profiles set role = 'gestor' where email = 'seu-email@exemplo.com';
```

**Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add profiles and audit_log schema with RLS"
```

---

## Task 6: Clientes Supabase (browser e server)

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Install: `@supabase/supabase-js`, `@supabase/ssr`

**Step 1: Instalar dependências**

Run: `npm install @supabase/supabase-js @supabase/ssr`

**Step 2: Cliente para Client Components**

```ts
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**Step 3: Cliente para Server Components / Route Handlers**

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // chamado de um Server Component sem permissão de escrita;
            // o middleware cuida do refresh de sessão nesse caso.
          }
        },
      },
    }
  );
}
```

**Step 4: Commit**

```bash
git add package.json package-lock.json lib/supabase
git commit -m "feat: add Supabase browser and server clients"
```

---

## Task 7: Módulo de permissões por papel + testes unitários

**Files:**
- Create: `lib/auth/permissions.ts`
- Create: `lib/auth/permissions.test.ts`
- Install: `vitest`

**Step 1: Instalar Vitest**

Run: `npm install -D vitest`

Adicionar em `package.json` → `scripts`:
```json
"test": "vitest run"
```

**Step 2: Escrever o teste que falha primeiro**

```ts
// lib/auth/permissions.test.ts
import { describe, expect, it } from "vitest";
import { canAccessRoute, type UserRole } from "./permissions";

describe("canAccessRoute", () => {
  it("permite gestor acessar qualquer rota do dashboard", () => {
    expect(canAccessRoute("gestor", "/dashboard/kanban")).toBe(true);
    expect(canAccessRoute("gestor", "/dashboard/aprovacoes")).toBe(true);
  });

  it("bloqueia operador de acessar aprovações", () => {
    expect(canAccessRoute("operador", "/dashboard/aprovacoes")).toBe(false);
  });

  it("permite operador acessar o dashboard raiz e o kanban", () => {
    expect(canAccessRoute("operador", "/dashboard")).toBe(true);
    expect(canAccessRoute("operador", "/dashboard/kanban")).toBe(true);
  });

  it("permite aprovador acessar aprovações mas não configurações de gestor", () => {
    expect(canAccessRoute("aprovador", "/dashboard/aprovacoes")).toBe(true);
    expect(canAccessRoute("aprovador", "/dashboard/configuracoes")).toBe(false);
  });

  it("retorna false para papel desconhecido", () => {
    expect(canAccessRoute("desconhecido" as UserRole, "/dashboard")).toBe(false);
  });
});
```

**Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run lib/auth/permissions.test.ts`
Expected: FAIL — `Cannot find module './permissions'`.

**Step 4: Implementar o módulo**

```ts
// lib/auth/permissions.ts
export type UserRole = "operador" | "aprovador" | "gestor";

type RoutePermission = {
  prefix: string;
  roles: UserRole[];
};

// Regras avaliadas na ordem declarada; a primeira que casar com o prefixo decide.
const ROUTE_PERMISSIONS: RoutePermission[] = [
  { prefix: "/dashboard/configuracoes", roles: ["gestor"] },
  { prefix: "/dashboard/aprovacoes", roles: ["aprovador", "gestor"] },
  { prefix: "/dashboard/kanban", roles: ["operador", "aprovador", "gestor"] },
  { prefix: "/dashboard", roles: ["operador", "aprovador", "gestor"] },
];

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  const rule = ROUTE_PERMISSIONS.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return false;
  return rule.roles.includes(role);
}
```

**Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run lib/auth/permissions.test.ts`
Expected: PASS (5 testes).

**Step 6: Commit**

```bash
git add package.json package-lock.json lib/auth
git commit -m "feat: add role-based route permissions with unit tests"
```

---

## Task 8: Middleware de sessão e proteção de rotas

**Files:**
- Create: `middleware.ts`

**Step 1: Implementar o middleware**

```ts
// middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessRoute, type UserRole } from "@/lib/auth/permissions";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  const isDashboardRoute = pathname.startsWith("/dashboard");

  if (!user && isDashboardRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (user && isDashboardRoute) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role as UserRole | undefined;

    if (!role || !canAccessRoute(role, pathname)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

**Step 2: Commit**

```bash
git add middleware.ts
git commit -m "feat: add auth middleware with role-based route protection"
```

---

## Task 9: Página de login

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/login/login-form.tsx`

**Step 1: Server Component da rota**

```tsx
// app/login/page.tsx
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <LoginForm />
    </div>
  );
}
```

**Step 2: Client Component com o formulário**

```tsx
// app/login/login-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError("E-mail ou senha inválidos.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Puzzle Records</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

**Step 3: Commit**

```bash
git add app/login
git commit -m "feat: add login page with email/password auth"
```

---

## Task 10: Shell do dashboard (sidebar/topbar) com navegação por papel

**Files:**
- Create: `components/layout/sidebar.tsx`
- Create: `components/layout/topbar.tsx`
- Create: `app/dashboard/layout.tsx`

**Step 1: Definir os itens de navegação e o papel mínimo exigido**

```tsx
// components/layout/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/permissions";

const NAV_ITEMS: { href: string; label: string; roles: UserRole[] }[] = [
  { href: "/dashboard", label: "Início", roles: ["operador", "aprovador", "gestor"] },
  { href: "/dashboard/kanban", label: "Kanban", roles: ["operador", "aprovador", "gestor"] },
  { href: "/dashboard/aprovacoes", label: "Aprovações", roles: ["aprovador", "gestor"] },
  { href: "/dashboard/configuracoes", label: "Configurações", roles: ["gestor"] },
];

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="w-56 shrink-0 border-r bg-muted/20 p-4">
      <nav className="flex flex-col gap-1">
        {visibleItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium hover:bg-muted",
              pathname === item.href && "bg-muted"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

Nota: itens de navegação que ainda não têm página nesta fase (`/dashboard/kanban`, `/dashboard/aprovacoes`, `/dashboard/configuracoes`) ficam visíveis apenas para papéis que teriam acesso, mas levam a uma rota que ainda não existe — isso é aceitável na Fase 0 (serão implementadas nas Fases 1, 4 e futuramente); se preferir, marque-os como `disabled` visualmente até lá.

**Step 2: Topbar simples com informação do usuário e logout**

```tsx
// components/layout/topbar.tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function Topbar({ email }: { email: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <span className="text-sm font-medium">Puzzle Records</span>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{email}</span>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sair
        </Button>
      </div>
    </header>
  );
}
```

**Step 3: Layout do grupo `/dashboard` (Server Component) buscando papel do usuário**

```tsx
// app/dashboard/layout.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import type { UserRole } from "@/lib/auth/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "operador") as UserRole;

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} />
      <div className="flex-1">
        <Topbar email={user.email ?? ""} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add components/layout app/dashboard/layout.tsx
git commit -m "feat: add dashboard shell with role-based sidebar navigation"
```

---

## Task 11: Página de dashboard vazia e redirecionamento raiz

**Files:**
- Create: `app/dashboard/page.tsx`
- Modify: `app/page.tsx`

**Step 1: Dashboard vazio**

```tsx
// app/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold">Nenhum item no pipeline ainda</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Assim que a Fase 1 (Ingestão) entrar no ar, os itens recebidos vão aparecer aqui.
      </p>
    </div>
  );
}
```

**Step 2: Rota raiz redireciona conforme sessão**

```tsx
// app/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
```

**Step 3: Commit**

```bash
git add app/dashboard/page.tsx app/page.tsx
git commit -m "feat: add empty dashboard page and root redirect"
```

---

## Task 12: Estrutura de fila Redis + BullMQ (sem jobs reais)

**Files:**
- Create: `workers/connection.ts`
- Create: `workers/queues.ts`
- Create: `workers/index.ts`
- Install: `bullmq`, `ioredis`

**Step 1: Instalar dependências**

Run: `npm install bullmq ioredis`

**Step 2: Conexão com o Redis (Upstash)**

```ts
// workers/connection.ts
import IORedis from "ioredis";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL não configurada");
}

export const redisConnection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
```

**Step 3: Registro das filas que serão usadas pelas próximas fases (vazio de workers/jobs por enquanto)**

```ts
// workers/queues.ts
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

// Cada fase adiciona sua fila aqui conforme os jobs forem implementados:
// Fase 1: ingestion-queue · Fase 2: caption-queue · Fase 3: render-queue · Fase 4: approval-queue
export const ingestionQueue = new Queue("ingestion", { connection: redisConnection });
```

**Step 4: Ponto de entrada para rodar workers como processo separado (ainda sem consumers)**

```ts
// workers/index.ts
import { redisConnection } from "./connection";

async function main() {
  const pong = await redisConnection.ping();
  console.log(`[workers] conexão com Redis OK (${pong}). Nenhum worker registrado ainda.`);
}

main().catch((err) => {
  console.error("[workers] falha ao conectar no Redis:", err);
  process.exit(1);
});
```

Adicionar em `package.json` → `scripts`:
```json
"workers": "tsx workers/index.ts"
```

Run: `npm install -D tsx`

**Step 5: Verificar a conexão localmente**

Run: `npm run workers`
Expected: `[workers] conexão com Redis OK (PONG). Nenhum worker registrado ainda.`

**Step 6: Commit**

```bash
git add package.json package-lock.json workers
git commit -m "feat: scaffold BullMQ queue structure with Upstash Redis connection"
```

---

## Task 13: QA manual local (checklist antes do deploy)

Sem servidor Supabase de teste automatizado nesta fase, a verificação é manual. Rode `npm run dev` e confira:

1. Acessar `http://localhost:3000` deslogado → deve redirecionar para `/login`.
2. Tentar acessar `http://localhost:3000/dashboard` deslogado → deve redirecionar para `/login`.
3. Criar um usuário de teste (Supabase Studio → Authentication → Add user, ou pelo próprio formulário se o signup estiver habilitado) e logar em `/login` → deve redirecionar para `/dashboard` mostrando "Nenhum item no pipeline ainda".
4. Com esse usuário como `operador` (padrão): sidebar mostra só "Início" e "Kanban"; acessar `/dashboard/aprovacoes` diretamente pela URL → deve redirecionar de volta para `/dashboard`.
5. Rodar `update public.profiles set role = 'aprovador' where email = '...'` no SQL Editor, deslogar e logar de novo → sidebar agora mostra "Aprovações" também, e a rota é acessível.
6. Rodar `update public.profiles set role = 'gestor' where email = '...'` → sidebar mostra todos os itens, incluindo "Configurações".
7. Clicar em "Sair" → volta para `/login` e `/dashboard` volta a redirecionar.
8. Rodar `npm run test` → todos os testes de `permissions.test.ts` passam.
9. Rodar `npm run build` → build de produção completa sem erros de tipo/lint.

Só prossiga para o deploy (Task 14) depois que todos os itens acima passarem.

---

## Task 14: Deploy inicial na Vercel

**Files:** nenhum arquivo novo — configuração via dashboard/CLI da Vercel.

**Step 1: Push final para o GitHub**

```bash
git push origin main
```

**Step 2: Conectar o repositório ao projeto Vercel**

No dashboard `https://vercel.com/viihcoimbra7x-9058s-projects`: **Add New → Project → Import Git Repository** e selecione `CoimbraViih/Puzzle_Records_new`. Mantenha o framework preset "Next.js" (detectado automaticamente).

**Step 3: Configurar variáveis de ambiente no projeto Vercel**

Em Project Settings → Environment Variables, adicione (ambiente "Preview"/staging, e depois "Production" quando for promover):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`

**Step 4: Disparar o deploy**

Clique em "Deploy" (ou faça um novo push para `main`, que dispara automaticamente após o projeto estar linkado).

Expected: build finaliza com sucesso e a Vercel expõe uma URL (`https://puzzle-records-new.vercel.app` ou similar).

**Step 5: Repetir o checklist da Task 13 contra a URL de produção/staging**

Login, redirecionamento por papel, e logout funcionando na URL pública — não só localmente.

**Step 6: Commit final de fechamento da fase (se houver ajustes feitos durante o deploy)**

```bash
git add -A
git commit -m "chore: finalize Fase 0 deployment configuration"
git push origin main
```

---

## Critério de pronto (definition of done da Fase 0)

- [ ] Usuário consegue logar via e-mail/senha.
- [ ] Dashboard vazio carrega após login, com layout de navegação (sidebar/topbar).
- [ ] Permissões por papel bloqueiam/liberam rotas corretamente (operador, aprovador, gestor), testado local e em produção.
- [ ] Deploy responde em produção na Vercel.
- [ ] Estrutura `/workers` conecta no Redis (Upstash) com sucesso, pronta para receber jobs nas próximas fases — sem nenhum job real implementado ainda.
- [ ] `npm run test` e `npm run build` passam sem erros.
