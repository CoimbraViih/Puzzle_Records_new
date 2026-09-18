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
