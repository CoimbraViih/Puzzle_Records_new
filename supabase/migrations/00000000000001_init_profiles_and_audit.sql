-- supabase/migrations/00000000000001_init_profiles_and_audit.sql

create type public.user_role as enum ('operador', 'aprovador', 'gestor');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  -- nullable: auth.users.email também é nullable (cadastro só por telefone,
  -- alguns provedores OAuth, sign-in anônimo) — NOT NULL aqui faria o
  -- trigger abaixo (e o backfill) abortar em qualquer conta assim.
  email text,
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
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- auditoria genérica, reaproveitada pelas próximas fases
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

create policy "audit_log_gestor_read"
  on public.audit_log for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'gestor')
  );

create policy "audit_log_authenticated_insert"
  on public.audit_log for insert
  with check (auth.uid() = actor_id);

-- backfill: usuários de auth.users criados antes desta migração não passam
-- pelo trigger acima (que só dispara em novos inserts) e ficariam sem uma
-- linha em public.profiles, o que faz proxy.ts tratá-los como "sem papel".
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
