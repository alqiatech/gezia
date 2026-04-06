/**
 * GEZIA — create-workspace
 * Crea un workspace compartido y lo vincula al dossier del creador.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode, corsPreflightResponse } from "../_shared/errors.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";
import { logAuditEvent } from "../_shared/audit.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return errorResponse(ErrorCode.INVALID_PAYLOAD, "POST required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  let body: {
    client_request_id: string;
    workspace_type: "couple" | "co_parent" | "family_pair";
    title: string;
    linked_dossier_id: string;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON inválido");
  }

  const { client_request_id, workspace_type, title, linked_dossier_id } = body;

  if (!client_request_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id requerido");
  if (!["couple", "co_parent", "family_pair"].includes(workspace_type)) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "workspace_type inválido");
  }
  if (!title?.trim() || title.length > 120) return errorResponse(ErrorCode.INVALID_PAYLOAD, "title inválido (máx 120 chars)");
  if (!linked_dossier_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "linked_dossier_id requerido");

  // Verificar ownership del dossier
  const { data: dossier } = await serviceClient
    .from("dossiers")
    .select("id, shared_workspace_enabled")
    .eq("id", linked_dossier_id)
    .eq("user_id", userId)
    .single();

  if (!dossier) return errorResponse(ErrorCode.INVALID_OWNERSHIP, "Dossier no encontrado");

  // Deduplicación
  const dedup = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "create_workspace",
    clientRequestId: client_request_id,
    resourceType: "shared_workspace",
  });

  if (dedup.isDuplicate) {
    return okResponse({ workspace_id: dedup.existingResourceId, duplicate: true }, 200);
  }

  // Crear workspace
  const { data: workspace, error: wsErr } = await serviceClient
    .from("shared_workspaces")
    .insert({ workspace_type, title, status: "active", created_by: userId })
    .select("id")
    .single();

  if (wsErr || !workspace) {
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Error al crear workspace");
  }

  const workspaceId = workspace.id as string;

  // Crear membresía del owner
  await serviceClient.from("shared_workspace_members").insert({
    workspace_id: workspaceId,
    user_id: userId,
    role: "owner",
    consent_status: "accepted",
    joined_at: new Date().toISOString(),
  });

  // Vincular dossier al workspace
  await serviceClient.from("workspace_dossier_links").insert({
    workspace_id: workspaceId,
    user_id: userId,
    dossier_id: linked_dossier_id,
  });

  // Activar shared_workspace_enabled en el dossier
  await serviceClient.from("dossiers").update({
    shared_workspace_enabled: true,
  }).eq("id", linked_dossier_id);

  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "create_workspace",
    clientRequestId: client_request_id,
    resourceId: workspaceId,
  });

  // Log en audit.share_log
  const { error: shareLogErr } = await serviceClient.schema("audit").from("share_log").insert({
    user_id: userId,
    workspace_id: workspaceId,
    action: "workspace_created",
    metadata: { workspace_type, linked_dossier_id },
  });
  if (shareLogErr) console.error("share_log insert error:", shareLogErr.message);

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "workspace.created",
    resource_type: "shared_workspace",
    resource_id: workspaceId,
    metadata: { workspace_type, linked_dossier_id },
  });

  return okResponse({ workspace_id: workspaceId, title, status: "active" }, 201);
});
