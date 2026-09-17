-- supabase/migrations/00000000000002_add_pipeline_items.sql
--
-- Fase 1 (Ingestão): pipeline_items armazena cada item de mídia bruta ingerido
-- (Drive ou Telegram), com estado de processamento. drive_sync_state controla
-- o Watch Channel do Drive. raw-media é o bucket de armazenamento para mídia.
-- Apenas service_role grava nessas tabelas; leitura restrita a equipe_conteudo,
-- editorial, admin via security definer.

create table public.pipeline_items (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('drive', 'telegram')),
  external_id text not null,
  status text not null default 'recebido'
    check (status in ('recebido', 'legenda', 'renderizando', 'aguardando_aprovacao', 'agendado', 'publicado', 'rejeitado')),
  title text,
  author text,
  mime_type text,
  drive_file_id text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origin, external_id)
);

create index pipeline_items_status_idx on public.pipeline_items (status);
create index pipeline_items_created_at_idx on public.pipeline_items (created_at desc);

alter table public.pipeline_items enable row level security;

-- Mesmo padrão da audit_log: função security definer própria para evitar
-- conflitos com o RLS de profiles e garantir que a checagem de role funcione
-- independentemente do role do authenticated que está consultando.
create function public.pipeline_items_viewer_has_role()
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

revoke execute on function public.pipeline_items_viewer_has_role() from public;
grant execute on function public.pipeline_items_viewer_has_role() to authenticated;

create policy "internal roles can read pipeline_items"
  on public.pipeline_items for select
  using (public.pipeline_items_viewer_has_role());

-- Sem policies de insert/update: só service_role (webhooks) grava, bypassando RLS.

-- drive_sync_state: linha única com estado do Watch Channel + pageToken de changes.list
create table public.drive_sync_state (
  id boolean primary key default true check (id),
  page_token text,
  channel_id text,
  channel_resource_id text,
  channel_expiration timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.drive_sync_state enable row level security;

-- Sem policies: só service_role acessa (RLS habilitado sem policy = nega tudo pra authenticated/anon).

-- Bucket raw-media para armazenamento de mídia ingerida (Telegram, por enquanto).
insert into storage.buckets (id, name, public)
values ('raw-media', 'raw-media', false)
on conflict (id) do nothing;
