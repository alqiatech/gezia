/**
 * GEZIA — revoke-shared-item
 * Solo el usuario fuente puede revocar. Marca revoked=true y registra en audit.
 */

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode, corsPreflightResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return errorResponse(ErrorCode.INVALID_PAYLOAD, "POST required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  let body: { shared_item_id: string };

  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON inválido");
  }

  const { shared_item_id } = body;
  if (!shared_item_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "shared_item_id requerido");

  // Verificar que el item existe y pertenece a este usuario
  const { data: item } = await serviceClient
    .from("shared_items")
    .select("id, workspace_id, scene_id, revoked, revocable")
    .eq("id", shared_item_id)
    .eq("shared_by_user_id", userId)
    .single();

  if (!item) return errorResponse(ErrorCode.INVALID_OWNERSHIP, "Elemento compartido no encontrado");
  if (item.revoked) return errorResponse(ErrorCode.INVALID_PAYLOAD, "Este elemento ya fue revocado");
  if (!item.revocable) return errorResponse(ErrorCode.INVALID_PAYLOAD, "Este elemento no es revocable");

  await serviceClient
    .from("shared_items")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("id", shared_item_id);

  // Log en audit.share_log
  const { error: shareLogErr } = await serviceClient.schema("audit").from("share_log").insert({
    user_id: userId,
    workspace_id: item.workspace_id,
    shared_item_id,
    action: "item_revoked",
    metadata: { scene_id: item.scene_id },
  });
  if (shareLogErr) console.error("share_log insert error:", shareLogErr.message);

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "workspace.item_revoked",
    resource_type: "shared_item",
    resource_id: shared_item_id,
    metadata: { workspace_id: item.workspace_id, scene_id: item.scene_id },
  });

  return okResponse({ shared_item_id, revoked: true }, 200);
});
