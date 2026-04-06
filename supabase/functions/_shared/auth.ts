// =============================================================================
// GEZIA — _shared/auth.ts
// Validación de JWT y extracción del usuario autenticado.
// Todas las Edge Functions que requieren auth usan este módulo.
// =============================================================================

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ErrorCode, errorResponse } from "./errors.ts";

export interface AuthContext {
  userId: string;
  supabase: SupabaseClient;   // cliente con el JWT del usuario (RLS activo)
  serviceClient: SupabaseClient; // cliente con service_role (bypass RLS — solo operaciones internas)
}

/**
 * Valida el JWT entrante y retorna el contexto de autenticación.
 * Si el JWT falta o es inválido, retorna una Response de error 401.
 * El llamador debe verificar si el resultado es instanceof Response.
 */
export async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(ErrorCode.UNAUTHORIZED, "Missing Authorization header");
  }

  const jwt = authHeader.replace("Bearer ", "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return errorResponse(ErrorCode.INTERNAL_ERROR);
  }

  // Cliente del usuario — respeta RLS
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    return errorResponse(ErrorCode.UNAUTHORIZED, "Invalid or expired token");
  }

  // Cliente de servicio — solo para operaciones internas del servidor
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  return { userId: user.id, supabase, serviceClient };
}
