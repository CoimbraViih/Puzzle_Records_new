-- supabase/migrations/00000000000005_add_manual_origin.sql
--
-- Botão "Criar post" no Kanban (/dashboard/kanban): permite a um usuário
-- logado criar um pipeline_item de teste diretamente pela UI, sem precisar
-- de Drive/Telegram/n8n configurados. Usa seu próprio valor de origin
-- ('manual') em vez de reaproveitar 'n8n', para não confundir itens de teste
-- manual com ingestão real de automações externas nos logs/Kanban.

alter table public.pipeline_items drop constraint pipeline_items_origin_check;
alter table public.pipeline_items
  add constraint pipeline_items_origin_check check (origin in ('drive', 'telegram', 'n8n', 'manual'));
