import { getServiceRoleClient } from "@/lib/supabase/service-role";

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
