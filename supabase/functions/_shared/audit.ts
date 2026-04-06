// =============================================================================
// GEZIA — _shared/audit.ts
// Registro de eventos en audit.event_log.
// Todas las Edge Functions críticas invocan esta función para dejar traza.
// =============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface AuditEvent {
  actorUserId: string;
  eventName: string;
  entitySchema?: string;
  entityTable?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Registra un evento en audit.event_log usando el service_role client.
 * Los errores en audit NO deben bloquear el flujo principal — se loguean pero no se propagan.
 */
export async function logAuditEvent(
  serviceClient: SupabaseClient,
  event: AuditEvent,
): Promise<void> {
  try {
    const { error } = await serviceClient.from("event_log").insert({
      actor_user_id: event.actorUserId,
      event_name: event.eventName,
      entity_schema: event.entitySchema ?? "public",
      entity_table: event.entityTable ?? null,
      entity_id: event.entityId ?? null,
      payload: event.payload ?? {},
    }).schema("audit");

    if (error) {
      console.error(`[audit] Failed to log event ${event.eventName}:`, error.message);
    }
  } catch (err) {
    console.error(`[audit] Unexpected error logging ${event.eventName}:`, err);
  }
}
