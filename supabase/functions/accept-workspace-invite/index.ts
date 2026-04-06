/**
 * GEZIA — accept-workspace-invite
 * Valida el token, crea membresía y vincula el dossier del invitado.
 */

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
    token: string;
    dossier_id: string;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON inválido");
  }

  const { client_request_id, token, dossier_id } = body;

  if (!client_request_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id requerido");
  if (!token?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "token requerido");
  if (!dossier_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "dossier_id requerido");

  // Hash SHA-256 del token recibido
  const encoder = new TextEncoder();
  const tokenData = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", tokenData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Buscar invitación válida
  const { data: invite } = await serviceClient
    .from("workspace_invites")
    .select("id, workspace_id, status, expires_at, inviter_id")
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!invite) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, "Invitación inválida, expirada o ya usada");

  // No permitir que el emisor se acepte a sí mismo
  if (invite.inviter_id === userId) {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "No puedes aceptar tu propia invitación");
  }

  // Verificar que ya no es miembro activo de este workspace
  const { data: existingMember } = await serviceClient
    .from("shared_workspace_members")
    .select("id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", userId)
    .eq("consent_status", "accepted")
    .single();

  if (existingMember) return errorResponse(ErrorCode.INVALID_PAYLOAD, "Ya eres miembro activo de este workspace");

  // Verificar ownership del dossier que el invitado quiere vincular
  const { data: dossier } = await serviceClient
    .from("dossiers")
    .select("id")
    .eq("id", dossier_id)
    .eq("user_id", userId)
    .single();

  if (!dossier) return errorResponse(ErrorCode.INVALID_OWNERSHIP, "Dossier no encontrado");

  // Deduplicación
  const dedup = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "accept_workspace_invite",
    clientRequestId: client_request_id,
    resourceType: "workspace_member",
  });

  if (dedup.isDuplicate) {
    return okResponse({ workspace_id: invite.workspace_id, duplicate: true }, 200);
  }

  // Crear membresía
  const { data: member, error: memberErr } = await serviceClient
    .from("shared_workspace_members")
    .insert({
      workspace_id: invite.workspace_id,
      user_id: userId,
      role: "member",
      consent_status: "accepted",
      joined_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (memberErr || !member) {
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Error al crear membresía");
  }

  // Vincular dossier del invitado al workspace
  await serviceClient.from("workspace_dossier_links").insert({
    workspace_id: invite.workspace_id,
    user_id: userId,
    dossier_id,
  });

  // Activar shared_workspace_enabled en el dossier del invitado
  await serviceClient.from("dossiers").update({
    shared_workspace_enabled: true,
  }).eq("id", dossier_id);

  // Marcar invitación como aceptada (single-use — UNIQUE constraint en token_hash)
  await serviceClient
    .from("workspace_invites")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "accept_workspace_invite",
    clientRequestId: client_request_id,
    resourceId: member.id,
  });

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "workspace.member_joined",
    resource_type: "shared_workspace",
    resource_id: invite.workspace_id,
    metadata: { invite_id: invite.id, dossier_id },
  });

  return okResponse({ workspace_id: invite.workspace_id, member_id: member.id }, 200);
});
