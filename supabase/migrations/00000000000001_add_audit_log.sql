-- supabase/migrations/00000000000001_add_audit_log.sql
--
-- O projeto Supabase é reaproveitado de uma versão anterior do produto:
-- public.profiles já existe, com RLS e uma função is_admin() próprias,
-- role como texto livre (default 'equipe_conteudo'; valores em uso:
-- 'equipe_conteudo', 'editorial', 'admin' — ver lib/auth/permissions.ts).
-- Esta migration NÃO mexe em profiles; só adiciona o que falta para a
-- Fase 0: a tabela de auditoria genérica (Seção 8 do PRD).

create table public.audit_log (
  id bigint generated always as identity primary key,
  -- set null (não cascade): o registro de auditoria deve sobreviver à
  -- exclusão do usuário que o gerou; NO ACTION (o padrão) bloquearia a
  -- exclusão de qualquer usuário que já tenha uma linha de auditoria.
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_created_at_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;

-- Checagem inline (não usa is_admin() do projeto pré-existente, porque não
-- controlamos essa função nem confirmamos suas grants — o teste com a anon
-- key retornou "permission denied for function is_admin" ao consultar
-- profiles, então mantemos audit_log auto-contido).
create policy "audit_log_admin_read"
  on public.audit_log for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "audit_log_authenticated_insert"
  on public.audit_log for insert
  with check (auth.uid() = actor_id);
