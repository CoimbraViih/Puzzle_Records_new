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
