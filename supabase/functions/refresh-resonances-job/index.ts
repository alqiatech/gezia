/**
 * GEZIA — refresh-resonances-job
 * Worker interno: detecta resonancias estructurales entre expedientes del mismo usuario.
 *
 * Reglas estrictas (del POLICY ENGINE V1):
 * - Solo corre si confidence >= 0.65 + risk green + recurrence >= 0.45
 * - No genera resonancias por escena única ambigua
 * - Resonancias son parecido estructural — NUNCA causalidad biográfica
 * - safe_summary: lenguaje permitido; blocked_summary: NUNCA expuesto al cliente
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callLLM, parseLLMJson, MODEL_VERSION } from "../_shared/llm.ts";
import { logAuditEvent } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_ID = crypto.randomUUID();

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

interface ResonanceCandidate {
  source_pattern_name: string;
  target_dossier_id: string;
  target_pattern_name: string;
  resonance_type: string;
  confidence_score: number;
  safe_summary: string;
  is_valid: boolean;
  reason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const db = svc();

  // -------------------------------------------------------------------------
  // CLAIM JOB
  // -------------------------------------------------------------------------
  const { data: jobs, error: claimErr } = await db
    .rpc("claim_next_job", { p_worker_id: WORKER_ID })
    .schema("app_private");

  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 });
  }
  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ status: "no_jobs" }), { status: 200 });
  }

  const job = jobs[0] as {
    id: string;
    job_type: string;
    payload: {
      dossier_id: string;
      user_id: string;
      scene_id: string;
    };
  };

  if (job.job_type !== "refresh_resonances") {
    await db.schema("app_private").from("job_queue").update({
      status: "pending",
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return new Response(JSON.stringify({ status: "skipped", job_type: job.job_type }), { status: 200 });
  }

  const { dossier_id, user_id, scene_id } = job.payload;

  try {
    await runRefreshResonances(db, { jobId: job.id, dossier_id, user_id, scene_id });
    return new Response(JSON.stringify({ status: "completed" }), { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("refresh-resonances-job error:", msg);

    await db.schema("app_private").from("job_queue").update({
      status: "failed",
      last_error: msg.substring(0, 500),
      locked_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});

// =============================================================================
// CORE LOGIC
// =============================================================================

async function runRefreshResonances(
  db: SupabaseClient,
  ctx: { jobId: string; dossier_id: string; user_id: string; scene_id: string },
) {
  const { jobId, dossier_id, user_id, scene_id } = ctx;

  // Fetch confirmed/high-confidence patterns of the source dossier
  const { data: sourcePatterns } = await db
    .from("patterns")
    .select("id, pattern_name, pattern_family, status, confidence, evidence_count, safe_summary")
    .eq("dossier_id", dossier_id)
    .in("status", ["confirmed"])
    .gte("confidence", 0.65)
    .order("confidence", { ascending: false })
    .limit(5);

  if (!sourcePatterns || sourcePatterns.length === 0) {
    await completeJob(db, jobId);
    return;
  }

  // Fetch all OTHER dossiers of this user
  const { data: otherDossiers } = await db
    .from("dossiers")
    .select("id, title, dossier_type")
    .eq("user_id", user_id)
    .neq("id", dossier_id)
    .eq("archived", false)
    .limit(10);

  if (!otherDossiers || otherDossiers.length === 0) {
    await completeJob(db, jobId);
    return;
  }

  // Fetch confirmed patterns from other dossiers
  const otherDossierIds = otherDossiers.map((d) => d.id);
  const { data: targetPatterns } = await db
    .from("patterns")
    .select("id, dossier_id, pattern_name, pattern_family, status, confidence, safe_summary")
    .in("dossier_id", otherDossierIds)
    .in("status", ["confirmed", "candidate"])
    .gte("confidence", 0.50)
    .limit(20);

  if (!targetPatterns || targetPatterns.length === 0) {
    await completeJob(db, jobId);
    return;
  }

  // Build comparison context for LLM
  const sourceDossier = await db
    .from("dossiers")
    .select("id, title, dossier_type")
    .eq("id", dossier_id)
    .single();

  const systemPrompt = `Eres un analizador de similitudes estructurales entre patrones relacionales.
Tu trabajo es detectar si patrones de diferentes vínculos de la misma persona comparten la misma dinámica subyacente.

REGLAS ABSOLUTAS:
- Las resonancias son parecido de patrón estructural, NUNCA causalidad biográfica.
- Nunca uses frases como "tu pareja es igual a tu mamá", "estás repitiendo a tu padre", "tu historia define esto".
- SOLO usa frases como "en ambos vínculos aparece una secuencia parecida", "hay una dinámica similar de…"
- No generes resonancias si la similitud es superficial o anecdótica.
- Una resonancia es válida cuando la SECUENCIA de conductas es estructuralmente idéntica o muy similar.
- confidence_score debe ser honesto: 0.65+ solo para similitudes claras y bien documentadas.
- is_valid solo puede ser true si confidence_score >= 0.65.`;

  const userPrompt = `Analiza si los patrones del vínculo "${sourceDossier.data?.title}" (${sourceDossier.data?.dossier_type}) tienen resonancias estructurales con patrones de otros vínculos del mismo usuario.

Patrones del vínculo fuente:
${JSON.stringify(sourcePatterns.map((p) => ({ name: p.pattern_name, family: p.pattern_family, summary: p.safe_summary, confidence: p.confidence })))}

Patrones de otros vínculos:
${JSON.stringify(targetPatterns.map((p) => ({
  dossier_id: p.dossier_id,
  dossier_title: otherDossiers.find((d) => d.id === p.dossier_id)?.title,
  name: p.pattern_name,
  family: p.pattern_family,
  summary: p.safe_summary,
  confidence: p.confidence,
})))}

Para cada posible resonancia válida, evalúa:
1. ¿Es la misma dinámica subyacente (no solo el mismo tema)?
2. ¿La secuencia de conductas es similar (no solo los sentimientos)?
3. ¿Hay suficiente evidencia en ambos lados?

resonance_type debe ser uno de: abandonment_activation_similarity, disapproval_collapse_similarity, boundary_guilt_similarity, distance_pursuit_similarity, authority_reactivity_similarity, sexual_shutdown_similarity, overexplaining_similarity, protective_withdrawal_similarity

safe_summary debe estar en este formato EXACTO y NUNCA usar causalidad:
"En este vínculo y en [nombre otro vínculo] aparece una secuencia parecida: [descripción estructural de la dinámica sin juicio]."

Devuelve JSON con este formato exacto:
{
  "resonances": [
    {
      "source_pattern_name": "",
      "target_dossier_id": "",
      "target_pattern_name": "",
      "resonance_type": "",
      "confidence_score": 0.0,
      "safe_summary": "",
      "is_valid": false,
      "reason": ""
    }
  ]
}`;

  const llmRes = await callLLM(systemPrompt, userPrompt);
  const parsed = parseLLMJson<{ resonances: ResonanceCandidate[] }>(llmRes.content);

  const validResonances = (parsed.resonances ?? []).filter(
    (r) => r.is_valid === true && r.confidence_score >= 0.65,
  );

  let upsertedCount = 0;

  for (const r of validResonances) {
    const targetDossier = otherDossiers.find((d) => d.id === r.target_dossier_id);
    if (!targetDossier) continue;

    // Upsert dossier_resonances — UNIQUE on (user_id, source_dossier_id, target_dossier_id, pattern_name)
    const { error: upsertErr } = await db
      .from("dossier_resonances")
      .upsert({
        user_id,
        source_dossier_id: dossier_id,
        target_dossier_id: r.target_dossier_id,
        pattern_name: r.source_pattern_name.substring(0, 120),
        resonance_type: r.resonance_type,
        confidence: parseFloat(r.confidence_score.toFixed(3)),
        safe_summary: r.safe_summary,
        last_scene_id: scene_id,
        model_version: MODEL_VERSION,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,source_dossier_id,target_dossier_id,pattern_name",
      });

    if (!upsertErr) upsertedCount++;
  }

  await logAuditEvent(db, {
    user_id,
    event_type: "resonances.refreshed",
    resource_type: "dossier",
    resource_id: dossier_id,
    metadata: { upserted: upsertedCount, evaluated: parsed.resonances?.length ?? 0, scene_id },
  });

  await completeJob(db, jobId);
}

async function completeJob(db: SupabaseClient, jobId: string) {
  await db.schema("app_private").from("job_queue").update({
    status: "completed",
    locked_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}
