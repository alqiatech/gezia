/**
 * GEZIA - delete-account
 * Eliminacion de cuenta. Orden:
 * 1. Confirmar DELETE_MY_ACCOUNT
 * 2. Revocar shared_items activos
 * 3. Marcar deletion_requested_at
 * 4. Borrar contenido de tablas publicas
 * 5. Anonimizar audit logs
 * 6. Borrar Storage
 * 7. Borrar auth.users via Admin API
 */

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode, corsPreflightResponse } from "../_shared/errors.ts";
import { logAuditEvent } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return errorResponse(ErrorCode.INVALID_PAYLOAD, "POST required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON invalido");
  }

  if (body["confirmation"] !== "DELETE_MY_ACCOUNT") {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Se requiere: { confirmation: 'DELETE_MY_ACCOUNT' }");
  }

  // 1. Revocar shared_items activos
  await serviceClient
    .from("shared_items")
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq("shared_by_user_id", userId)
    .eq("revoked", false);

  // 2. Marcar deletion_requested_at
  await serviceClient
    .from("profiles")
    .update({ deletion_requested_at: new Date().toISOString() })
    .eq("id", userId);

  // 3. Log
  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "account.deletion_requested",
    resource_type: "account",
    resource_id: userId,
    metadata: {},
  });

  // 4. Invitaciones enviadas
  await serviceClient.from("workspace_invites").delete().eq("inviter_id", userId);

  // 5. Membresias de workspaces
  await serviceClient.from("shared_workspace_members").delete().eq("user_id", userId);

  // 6. Vinculos dossier-workspace
  await serviceClient.from("workspace_dossier_links").delete().eq("user_id", userId);

  // 7. Outcomes de intervenciones
  const { data: userInterventions } = await serviceClient
    .from("interventions")
    .select("id")
    .eq("user_id", userId);

  const interventionIds = (userInterventions ?? []).map((i: { id: string }) => i.id);
  if (interventionIds.length > 0) {
    await serviceClient.from("intervention_outcomes").delete().in("intervention_id", interventionIds);
  }

  // 8. Intervenciones
  await serviceClient.from("interventions").delete().eq("user_id", userId);

  // 9. Escenas y datos dependientes
  const { data: userScenes } = await serviceClient.from("scenes").select("id").eq("user_id", userId);
  const sceneIds = (userScenes ?? []).map((s: { id: string }) => s.id);

  if (sceneIds.length > 0) {
    await serviceClient.from("scene_outputs").delete().in("scene_id", sceneIds);
    await serviceClient.from("scene_facts").delete().in("scene_id", sceneIds);
    await serviceClient.from("scene_signals").delete().in("scene_id", sceneIds);
    await serviceClient.schema("app_private").from("inference_runs").delete().in("scene_id", sceneIds);
    await serviceClient.schema("app_private").from("policy_decisions").delete().in("scene_id", sceneIds);
    await serviceClient.schema("app_private").from("prompt_snapshots").delete().in("scene_id", sceneIds);
    await serviceClient.schema("app_private").from("response_assemblies").delete().in("scene_id", sceneIds);
    await serviceClient.schema("app_private").from("safety_triage_runs").delete().in("scene_id", sceneIds);
  }
  await serviceClient.from("scenes").delete().eq("user_id", userId);

  // 10. Patrones
  await serviceClient.from("patterns").delete().eq("user_id", userId);

  // 11. Baselines y resonancias
  await serviceClient.from("dossier_baselines").delete().eq("user_id", userId);
  await serviceClient.from("dossier_resonances").delete().eq("user_id", userId);

  // 12. Acuerdos compartidos
  await serviceClient.from("shared_agreements").delete().eq("created_by", userId);

  // 13. Dossiers
  await serviceClient.from("dossiers").delete().eq("user_id", userId);

  // 14. Dedup y job_queue
  await serviceClient.schema("app_private").from("request_dedup").delete().eq("user_id", userId);
  await serviceClient.schema("app_private").from("job_queue").delete().eq("user_id", userId);

  // 15. Anonimizar audit logs
  await serviceClient.schema("audit").from("event_log")
    .update({ user_id: "deleted" })
    .eq("user_id", userId);

  await serviceClient.schema("audit").from("share_log")
    .update({ user_id: "deleted" })
    .eq("user_id", userId);

  // 16. Storage
  const buckets = ["scene-audio-private", "scene-images-private", "secure-docs-private"];
  for (const bucket of buckets) {
    const { data: files } = await serviceClient.storage.from(bucket).list(userId, { limit: 1000 });
    if (files && files.length > 0) {
      const paths = files.map((f: { name: string }) => `${userId}/${f.name}`);
      await serviceClient.storage.from(bucket).remove(paths);
    }
  }

  // 17. Perfil
  await serviceClient.from("profiles").delete().eq("id", userId);

  // 18. auth.users via Admin API
  const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
  });

  if (!adminRes.ok) {
    const errText = await adminRes.text();
    console.error("Error eliminando auth.users:", errText);
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Error al eliminar usuario de autenticacion");
  }

  return okResponse({ deleted: true }, 200);
});
