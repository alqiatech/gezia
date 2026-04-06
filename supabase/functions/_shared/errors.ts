// =============================================================================
// GEZIA — _shared/errors.ts
// Códigos de error canónicos del sistema y helper de respuesta de error.
// Todas las Edge Functions usan este módulo para respuestas de error uniformes.
// =============================================================================

export const ErrorCode = {
  INVALID_OWNERSHIP:               "INVALID_OWNERSHIP",
  INVALID_PAYLOAD:                 "INVALID_PAYLOAD",
  DUPLICATE_REQUEST:               "DUPLICATE_REQUEST",
  RESOURCE_NOT_FOUND:              "RESOURCE_NOT_FOUND",
  PROCESSING_IN_PROGRESS:          "PROCESSING_IN_PROGRESS",
  WORKSPACE_NOT_LINKED_TO_DOSSIER: "WORKSPACE_NOT_LINKED_TO_DOSSIER",
  SHARE_NOT_ELIGIBLE:              "SHARE_NOT_ELIGIBLE",
  UNAUTHORIZED:                    "UNAUTHORIZED",
  INTERNAL_ERROR:                  "INTERNAL_ERROR",
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_OWNERSHIP:               403,
  INVALID_PAYLOAD:                 400,
  DUPLICATE_REQUEST:               409,
  RESOURCE_NOT_FOUND:              404,
  PROCESSING_IN_PROGRESS:          409,
  WORKSPACE_NOT_LINKED_TO_DOSSIER: 403,
  SHARE_NOT_ELIGIBLE:              403,
  UNAUTHORIZED:                    401,
  INTERNAL_ERROR:                  500,
};

/**
 * Construye una Response de error limpia para el cliente.
 * Nunca incluye stacktrace ni detalles internos.
 */
export function errorResponse(code: ErrorCode, message?: string): Response {
  return new Response(
    JSON.stringify({ error: code, message: message ?? code }),
    {
      status: HTTP_STATUS[code],
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Construye una Response de éxito con body JSON.
 */
export function okResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
