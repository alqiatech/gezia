/**
 * GEZIA — invite-workspace-member
 * Genera una invitación (single-use, 7 días) para unirse a un workspace.
 * NUNCA almacena el token en plano — solo el hash SHA-256.
 */

import { requireAuth } from "../_shared/auth.ts";
import { errorResponse, okResponse, ErrorCode } from "../_shared/errors.ts";
import { checkAndRegisterDedup, markDedupCompleted } from "../_shared/dedup.ts";
import { logAuditEvent } from "../_shared/audit.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return errorResponse(ErrorCode.INVALID_PAYLOAD, "POST required");

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, serviceClient } = auth;

  let body: {
    client_request_id: string;
    workspace_id: string;
    invited_email?: string;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.INVALID_PAYLOAD, "Body JSON inválido");
  }

  const { client_request_id, workspace_id, invited_email } = body;

  if (!client_request_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "client_request_id requerido");
  if (!workspace_id?.trim()) return errorResponse(ErrorCode.INVALID_PAYLOAD, "workspace_id requerido");

  // Verificar que el caller es miembro activo del workspace
  const { data: membership } = await serviceClient
    .from("shared_workspace_members")
    .select("id, role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", userId)
    .eq("status", "active")
    .single();

  if (!membership) return errorResponse(ErrorCode.UNAUTHORIZED, "No eres miembro activo de este workspace");

  // Verificar que el workspace está activo
  const { data: workspace } = await serviceClient
    .from("shared_workspaces")
    .select("id, status")
    .eq("id", workspace_id)
    .eq("status", "active")
    .single();

  if (!workspace) return errorResponse(ErrorCode.RESOURCE_NOT_FOUND, "Workspace no encontrado o inactivo");

  // Deduplicación
  const dedup = await checkAndRegisterDedup(serviceClient, {
    userId,
    operationName: "invite_workspace_member",
    clientRequestId: client_request_id,
    resourceType: "workspace_invite",
  });

  if (dedup.isDuplicate) {
    return okResponse({ invite_id: dedup.existingResourceId, duplicate: true }, 200);
  }

  // Generar token aleatorio (UUID v4) — NUNCA se almacena en plano
  const rawToken = crypto.randomUUID();

  // Hash SHA-256 del token
  const encoder = new TextEncoder();
  const data = encoder.encode(rawToken);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error: invErr } = await serviceClient
    .from("workspace_invites")
    .insert({
      workspace_id,
      inviter_id: userId,
      token_hash: tokenHash,
      invitee_email: invited_email ?? null,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (invErr || !invite) {
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Error al crear invitación");
  }

  await markDedupCompleted(serviceClient, {
    userId,
    operationName: "invite_workspace_member",
    clientRequestId: client_request_id,
    resourceId: invite.id,
  });

  await logAuditEvent(serviceClient, {
    user_id: userId,
    event_type: "workspace.invite_created",
    resource_type: "workspace_invite",
    resource_id: invite.id,
    metadata: { workspace_id, invited_email: invited_email ?? null },
  });

  // Devolver el token en plano al caller (para que lo comparta) — solo aparece aquí, nunca en DB
  return okResponse({
    invite_id: invite.id,
    token: rawToken,
    expires_at: expiresAt,
  }, 201);
});
