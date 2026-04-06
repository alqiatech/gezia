// =============================================================================
// GEZIA — _shared/dedup.ts
// Deduplicación de peticiones del cliente via app_private.request_dedup.
// Garantiza idempotencia para operaciones que crean recursos.
// =============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface DedupResult {
  isDuplicate: boolean;
  existingResourceId?: string;
}

/**
 * Verifica si la petición (user_id + operation_name + client_request_id) ya existe.
 * Si no existe la registra como 'processing'.
 * Si existe y está 'completed', retorna isDuplicate=true con el recurso original.
 * Si existe y está 'processing', retorna isDuplicate=true (no duplicar).
 */
export async function checkAndRegisterDedup(
  serviceClient: SupabaseClient,
  params: {
    userId: string;
    operationName: string;
    clientRequestId: string;
    resourceType?: string;
  },
): Promise<DedupResult> {
  const { userId, operationName, clientRequestId, resourceType } = params;

  // Buscar si ya existe
  const { data: existing, error: selectError } = await serviceClient
    .schema("app_private")
    .from("request_dedup")
    .select("id, status, resource_id")
    .eq("user_id", userId)
    .eq("operation_name", operationName)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();

  if (selectError) {
    console.error("[dedup] select error:", selectError.message);
    // En caso de fallo de dedup, dejamos pasar — no bloqueamos la operación
    return { isDuplicate: false };
  }

  if (existing) {
    return {
      isDuplicate: true,
      existingResourceId: existing.resource_id ?? undefined,
    };
  }

  // Registrar la nueva petición como 'processing'
  const { error: insertError } = await serviceClient
    .schema("app_private")
    .from("request_dedup")
    .insert({
      user_id: userId,
      operation_name: operationName,
      client_request_id: clientRequestId,
      resource_type: resourceType ?? null,
      status: "processing",
    });

  if (insertError) {
    // Si falla por unique constraint (concurrencia), es un duplicado
    if (insertError.code === "23505") {
      return { isDuplicate: true };
    }
    console.error("[dedup] insert error:", insertError.message);
  }

  return { isDuplicate: false };
}

/**
 * Marca una petición de deduplicación como completada y registra el recurso creado.
 */
export async function markDedupCompleted(
  serviceClient: SupabaseClient,
  params: {
    userId: string;
    operationName: string;
    clientRequestId: string;
    resourceId: string;
  },
): Promise<void> {
  const { userId, operationName, clientRequestId, resourceId } = params;

  const { error } = await serviceClient
    .schema("app_private")
    .from("request_dedup")
    .update({ status: "completed", resource_id: resourceId })
    .eq("user_id", userId)
    .eq("operation_name", operationName)
    .eq("client_request_id", clientRequestId);

  if (error) {
    console.error("[dedup] mark completed error:", error.message);
  }
}
