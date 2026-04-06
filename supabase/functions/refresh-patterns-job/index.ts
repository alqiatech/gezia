/**
 * GEZIA — refresh-patterns-job
 * Worker interno: actualiza patrones y baselines tras un follow-up reportado.
 * Encola refresh-resonances si hay evidencia suficiente.
 *
 * NO está expuesta al cliente. Solo se invoca desde job_queue (job_type = refresh_patterns).
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { calcPatternConfidence, resolvePatternStatus } from "../_shared/policy.ts";
import { logAuditEvent } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_ID = crypto.randomUUID();

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
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
      intervention_outcome_id: string;
      intervention_id: string;
      scene_id: string;
      dossier_id: string;
      user_id: string;
    };
  };

  // Solo procesamos refresh_patterns aquí
  if (job.job_type !== "refresh_patterns") {
    // Devolver el job al pool — no es nuestro
    await db.schema("app_private").from("job_queue").update({
      status: "pending",
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
    return new Response(JSON.stringify({ status: "skipped", job_type: job.job_type }), { status: 200 });
  }

  const { intervention_outcome_id, intervention_id, scene_id, dossier_id, user_id } = job.payload;

  try {
    await runRefreshPatterns(db, {
      jobId: job.id,
      intervention_outcome_id,
      intervention_id,
      scene_id,
      dossier_id,
      user_id,
    });

    return new Response(JSON.stringify({ status: "completed" }), { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("refresh-patterns-job error:", msg);

    await db.rpc("fail_job", {
      p_job_id: job.id,
      p_scene_id: scene_id,
      p_error_message: msg.substring(0, 500),
      p_error_code: "REFRESH_PATTERNS_ERROR",
    }).schema("app_private");

    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});

// =============================================================================
// CORE LOGIC
// =============================================================================

async function runRefreshPatterns(
  db: SupabaseClient,
  ctx: {
    jobId: string;
    intervention_outcome_id: string;
    intervention_id: string;
    scene_id: string;
    dossier_id: string;
    user_id: string;
  },
) {
  const { jobId, intervention_outcome_id, intervention_id, scene_id, dossier_id, user_id } = ctx;

  // Fetch outcome
  const { data: outcome } = await db
    .from("intervention_outcomes")
    .select("*")
    .eq("id", intervention_outcome_id)
    .single();

  if (!outcome) throw new Error("intervention_outcome not found");

  const effect = outcome.intervention_effect as string;
  const isPositive = effect === "positive";
  const isNegative = effect === "negative";

  // Fetch scene risk level (only update patterns when green)
  const { data: scene } = await db
    .from("scenes")
    .select("risk_level, recurrence_level, evidence_density")
    .eq("id", scene_id)
    .single();

  const riskLevel = (scene?.risk_level ?? "green") as string;

  // Fetch all pattern_evidence linked to this scene
  const { data: evidences } = await db
    .from("pattern_evidence")
    .select("id, pattern_id, weight")
    .eq("scene_id", scene_id)
    .eq("user_id", user_id);

  if (evidences && evidences.length > 0) {
    for (const ev of evidences) {
      // Adjust weight based on outcome
      let newWeight = ev.weight as number;
      if (isPositive) newWeight = Math.min(1.0, newWeight + 0.10);
      else if (isNegative) newWeight = Math.max(0.1, newWeight - 0.05);

      await db.from("pattern_evidence").update({
        weight: parseFloat(newWeight.toFixed(3)),
        rationale: `Actualizado por follow-up: ${effect}`,
      }).eq("id", ev.id);

      // Update the pattern itself
      const { data: pattern } = await db
        .from("patterns")
        .select("id, evidence_count, status, confidence")
        .eq("id", ev.pattern_id)
        .single();

      if (!pattern) continue;

      const newEvidenceCount = pattern.evidence_count as number;
      const newStatus = resolvePatternStatus(newEvidenceCount, riskLevel);
      const newConfidence = calcPatternConfidence(newEvidenceCount);

      await db.from("patterns").update({
        status: newStatus,
        confidence: newConfidence,
        updated_at: new Date().toISOString(),
      }).eq("id", ev.pattern_id);
    }
  }

  // Update dossier_baselines things_that_help / things_that_worsen
  const { data: baseline } = await db
    .from("dossier_baselines")
    .select("id, things_that_help, things_that_worsen")
    .eq("dossier_id", dossier_id)
    .single();

  if (baseline && outcome.user_action_taken?.trim()) {
    const actionText = outcome.user_action_taken.substring(0, 200);

    if (isPositive) {
      const current: string[] = baseline.things_that_help ?? [];
      if (!current.includes(actionText)) {
        await db.from("dossier_baselines").update({
          things_that_help: [...current, actionText].slice(-20),
          updated_at: new Date().toISOString(),
        }).eq("id", baseline.id);
      }
    } else if (isNegative) {
      const current: string[] = baseline.things_that_worsen ?? [];
      if (!current.includes(actionText)) {
        await db.from("dossier_baselines").update({
          things_that_worsen: [...current, actionText].slice(-20),
          updated_at: new Date().toISOString(),
        }).eq("id", baseline.id);
      }
    }
  }

  // Log
  await logAuditEvent(db, {
    user_id,
    event_type: "patterns.refreshed",
    resource_type: "dossier",
    resource_id: dossier_id,
    metadata: { intervention_outcome_id, effect, scene_id },
  });

  // Conditionally queue refresh_resonances
  const recurrence = scene?.recurrence_level ?? 0;
  const evidenceDensity = scene?.evidence_density ?? 0;
  const shouldRefreshResonances =
    riskLevel === "green" &&
    (recurrence as number) >= 0.45 &&
    (evidenceDensity as number) >= 0.50;

  if (shouldRefreshResonances) {
    await db.schema("app_private").from("job_queue").insert({
      job_type: "refresh_resonances",
      payload: { dossier_id, user_id, scene_id, trigger: "pattern_refresh" },
      status: "pending",
      run_after: new Date().toISOString(),
      max_attempts: 2,
    });
  }

  // Complete the job
  await db.schema("app_private").from("job_queue").update({
    status: "completed",
    locked_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}
