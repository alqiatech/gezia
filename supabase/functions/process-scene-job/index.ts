/**
 * GEZIA — process-scene-job
 * Pipeline de inferencia asíncrona. 8 módulos en cadena.
 *
 * Módulos:
 *   A. Router de Seguridad (triage)
 *   B. Normalizador de Escena
 *   C. Lector de Expediente  (DB — sin LLM)
 *   D. Motor de Lectura
 *   E. Motor de Confrontación Calibrada
 *   F. Motor de Movimiento
 *   G. Ensamblador Final
 *   H. Actualización de Patrones (lógica — sin LLM)
 *
 * Invocado por cron job o manualmente. Cada ejecución procesa UN job.
 */

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callLLM, parseLLMJson, MODEL_VERSION } from "../_shared/llm.ts";
import {
  calcConfrontationEligibility,
  capConfrontationLevel,
  calcPatternConfidence,
  resolvePatternStatus,
  LIMIT_TEXT_FALLBACK,
} from "../_shared/policy.ts";
import { logAuditEvent } from "../_shared/audit.ts";

// =============================================================================
// WORKER SETUP
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_ID = crypto.randomUUID();

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// =============================================================================
// PROMPTS — exactos del PROMPT PACK V1
// =============================================================================

const SYSTEM_GLOBAL = `Eres un sistema de interpretación relacional privada. Tu función es ayudar al usuario a entender dinámicas, secuencias y patrones repetidos en vínculos importantes.

No eres terapeuta, juez moral, oráculo, detective ni diagnosticador de personas.

Tu trabajo es:
1. separar hechos de interpretaciones
2. detectar patrones con base en evidencia interna
3. devolver responsabilidad al usuario sin humillarlo
4. confrontar sólo cuando haya base suficiente
5. evitar conclusiones no demostradas
6. frenar o cambiar de modo cuando haya riesgo

Reglas absolutas:
- No diagnostiques.
- No atribuyas intención como hecho.
- No conviertas hipótesis en sentencias.
- No halagues ni valides por reflejo.
- No uses tono condescendiente.
- No uses frases genéricas de autoayuda.
- No tomes partido.
- No generes pruebas para atacar a otra persona.
- No romantices dolor, control, celos, persecución o sufrimiento.
- No confundas activación emocional con verdad.

Tu voz debe ser: lúcida, firme, sobria, precisa, humana, no complaciente.

Lenguaje prohibido: "te está manipulando", "ya no te ama", "lo hizo para dañarte", "tu mamá es narcisista", "eres dependiente", "eres apego ansioso", "te victimizas", "estás loca", "claramente el otro está mal", "hiciste todo bien".

Lenguaje permitido: "esto se parece a…", "hay señales consistentes con…", "esto no confirma intención…", "tu lectura va más rápido que la evidencia…", "tu necesidad puede ser válida, tu forma de descargarla no necesariamente…"

Trabaja siempre con esta lógica: hecho → lectura probable → límite de certeza → parte del usuario → fricción → movimiento → límite del sistema.`;

// =============================================================================
// TYPES
// =============================================================================

interface RouterOutput {
  risk_level: "green" | "amber" | "red" | "black";
  risk_types: string[];
  allow_relational_inference: boolean;
  allow_confrontation: boolean;
  required_mode: string;
  notes: string;
}

interface NormalizadorOutput {
  scene_title: string;
  event_type: string;
  facts: string[];
  quotes_user: string[];
  quotes_other: string[];
  post_event_change: string[];
  user_emotions: string[];
  user_meanings: string[];
  user_actions: string[];
  memory_links: string[];
  ambiguities: string[];
  missing_data: string[];
}

interface LecturaOutput {
  observable: string;
  probable_dynamics: string[];
  not_proven: string[];
  user_part: string[];
  friction_candidates: string[];
  confidence: number;
  recommended_mode: string;
  // Extended variables (añadidas al prompt)
  activation_level: number;
  evidence_density: number;
  recurrence_level: number;
  distortion_level: number;
  externalization_level: number;
}

interface ConfrontacionOutput {
  should_confront: boolean;
  confrontation_level: number;
  core_friction: string;
  supporting_evidence: string[];
  soft_version: string;
  firm_version: string;
  blocked_phrases: string[];
}

interface MovimientoOutput {
  internal_move: string;
  external_move: string;
  suggested_phrase: string;
  avoid_now: string[];
  followup_signal_watch: string[];
}

interface EnsambladorOutput {
  observable_text: string;
  probable_text: string;
  not_proven_text: string;
  user_part_text: string;
  friction_text: string;
  movement_text: string;
  limit_text: string;
  avoid_now_text: string;
  suggested_phrase: string;
  final_text: string;
}

// =============================================================================
// HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const svc = serviceClient();
  const startTime = Date.now();

  // ---------------------------------------------------------------------------
  // 1. CLAIM JOB
  // ---------------------------------------------------------------------------
  const { data: jobs, error: claimErr } = await svc.rpc("claim_next_job", {
    p_worker_id: WORKER_ID,
  }).schema("app_private");

  if (claimErr) {
    console.error("claim_next_job error:", claimErr);
    return new Response(JSON.stringify({ error: "Failed to claim job" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ status: "no_jobs" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const job = jobs[0] as {
    id: string;
    job_type: string;
    payload: { scene_id: string; user_id: string; dossier_id: string };
    attempt_count: number;
    max_attempts: number;
  };

  const { scene_id, user_id, dossier_id } = job.payload;

  // ---------------------------------------------------------------------------
  // 2. CREATE INFERENCE RUN
  // ---------------------------------------------------------------------------
  const { data: inferenceRunRow, error: irErr } = await svc
    .schema("app_private")
    .from("inference_runs")
    .insert({
      user_id,
      dossier_id,
      scene_id,
      job_id: job.id,
      model_versions: { llm: MODEL_VERSION },
    })
    .select("id")
    .single();

  if (irErr || !inferenceRunRow) {
    await markFailed(svc, job.id, scene_id, "INFERENCE_RUN_CREATE_FAILED", irErr?.message ?? "unknown");
    return new Response(JSON.stringify({ error: "Failed to create inference_run" }), { status: 500 });
  }

  const inferenceRunId = inferenceRunRow.id as string;

  // Link inference run to scene
  await svc.from("scenes").update({
    last_inference_run_id: inferenceRunId,
    processing_status: "triage_running",
  }).eq("id", scene_id);

  // ---------------------------------------------------------------------------
  // RUN PIPELINE
  // ---------------------------------------------------------------------------
  try {
    await runPipeline(svc, {
      job,
      inferenceRunId,
      scene_id,
      user_id,
      dossier_id,
      startTime,
    });

    return new Response(JSON.stringify({ status: "completed", scene_id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Pipeline error for scene ${scene_id}:`, msg);
    await markFailed(svc, job.id, scene_id, "PIPELINE_ERROR", msg);

    await svc.schema("app_private").from("inference_runs").update({
      success: false,
      error_message: msg,
      duration_ms: Date.now() - startTime,
    }).eq("id", inferenceRunId);

    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});

// =============================================================================
// PIPELINE
// =============================================================================

async function runPipeline(
  svc: SupabaseClient,
  ctx: {
    job: { id: string; attempt_count: number };
    inferenceRunId: string;
    scene_id: string;
    user_id: string;
    dossier_id: string;
    startTime: number;
  },
) {
  const { inferenceRunId, scene_id, user_id, dossier_id, startTime } = ctx;

  // ---------------------------------------------------------------------------
  // FETCH SCENE (includes raw_user_narrative via service_role)
  // ---------------------------------------------------------------------------
  const { data: scene, error: sceneErr } = await svc
    .from("scenes")
    .select("*")
    .eq("id", scene_id)
    .single();
  if (sceneErr || !scene) throw new Error("Scene not found: " + sceneErr?.message);

  const rawNarrative = scene.raw_user_narrative as string;
  if (!rawNarrative?.trim()) throw new Error("raw_user_narrative is empty");

  // ---------------------------------------------------------------------------
  // FETCH DOSSIER + BASELINE
  // ---------------------------------------------------------------------------
  const [dossierRes, baselineRes, activePatternsRes, prevFlagsRes] =
    await Promise.all([
      svc.from("dossiers").select("*").eq("id", dossier_id).single(),
      svc.from("dossier_baselines").select("*").eq("dossier_id", dossier_id).single(),
      svc
        .from("patterns")
        .select("id, pattern_name, pattern_family, status, confidence, evidence_count, safe_summary, blocked_summary")
        .eq("dossier_id", dossier_id)
        .in("status", ["candidate", "confirmed"])
        .order("confidence", { ascending: false })
        .limit(10),
      svc
        .from("safety_flags")
        .select("risk_level, risk_types, created_at")
        .eq("user_id", user_id)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const dossier = dossierRes.data;
  const baseline = baselineRes.data;
  const activePatterns = activePatternsRes.data ?? [];
  const prevFlags = prevFlagsRes.data ?? [];

  if (!dossier) throw new Error("Dossier not found");

  // ===========================================================================
  // MODULE A — ROUTER DE SEGURIDAD
  // ===========================================================================
  const routerPrompt = `Tu tarea es clasificar seguridad y riesgo. No interpretes el vínculo más allá de lo necesario para esta clasificación.

Debes detectar si hay señales de:
- autolesión o suicidio
- violencia física
- violencia sexual
- coerción
- amenazas
- stalking o vigilancia
- aislamiento extremo
- terror persistente
- abuso posible o probable
- desorganización severa
- crisis aguda
- información insuficiente para una lectura segura

Clasifica en:
green = conflicto relacional normal
amber = activación alta, ambigüedad relevante o posible riesgo leve
red = riesgo importante, posible abuso o daño significativo
black = riesgo grave o urgente de seguridad inmediata

Reglas:
- Si el caso es red o black, bloquea confrontación relacional normal.
- Si el caso es red o black, bloquea lectura sobre intención del otro.
- Si el caso es amber, reduce certeza y marca cautela.
- Si el caso es green, permite procesamiento normal.

Flags previos de este usuario: ${JSON.stringify(prevFlags)}.

Devuelve sólo JSON con este formato exacto:
{
  "risk_level": "green|amber|red|black",
  "risk_types": [],
  "allow_relational_inference": true,
  "allow_confrontation": true,
  "required_mode": "S0|S1|S2|S3|S4|S5",
  "notes": ""
}`;

  const routerRes = await callLLM(SYSTEM_GLOBAL, `Relato del usuario:\n\n${rawNarrative}\n\nExpediente: ${dossier.title} (${dossier.dossier_type})\n\n${routerPrompt}`);
  const routerOutput = parseLLMJson<RouterOutput>(routerRes.content);

  // Persist Module A
  await svc.schema("app_private").from("inference_runs").update({
    risk_payload: routerOutput,
  }).eq("id", inferenceRunId);

  // Persist safety triage run
  await svc.schema("app_private").from("safety_triage_runs").insert({
    inference_run_id: inferenceRunId,
    scene_id,
    user_id,
    risk_level: routerOutput.risk_level,
    risk_types: routerOutput.risk_types ?? [],
    signals_detected: { notes: routerOutput.notes },
    decision_rationale: routerOutput.notes,
  });

  // ---- RISK CLOSURE PATH ----
  if (routerOutput.risk_level === "red" || routerOutput.risk_level === "black") {
    // Insert safety flag
    const { data: flagRow } = await svc.from("safety_flags").insert({
      user_id,
      dossier_id,
      scene_id,
      risk_level: routerOutput.risk_level,
      risk_types: routerOutput.risk_types ?? [],
      active: true,
      notes: routerOutput.notes,
    }).select("id").single();

    if (flagRow) {
      await svc.from("safety_events").insert({
        user_id,
        safety_flag_id: flagRow.id,
        event_type: "pipeline_triage_block",
        description: `Motor de seguridad bloqueó inferencia. Nivel: ${routerOutput.risk_level}. Tipos: ${(routerOutput.risk_types ?? []).join(", ")}`,
      });
    }

    // Insert scene_output (safety mode — no relational content)
    const safetyFinalText = routerOutput.risk_level === "black"
      ? "Esta situación requires atención inmediata de apoyo especializado. Por favor comunícate con una línea de crisis o profesional de salud. No es seguro que continúe sola/solo con esto."
      : "Lo que describes tiene señales que me piden pausar el análisis relacional normal. Tu seguridad primero. Considera hablar con alguien de confianza o un profesional antes de continuar.";

    await svc.from("scene_outputs").upsert({
      scene_id,
      user_id,
      mode: "S0",
      risk_level: routerOutput.risk_level,
      confidence: 0.00,
      observable_text: null,
      probable_text: null,
      not_proven_text: null,
      user_part_text: null,
      friction_text: null,
      movement_text: null,
      limit_text: LIMIT_TEXT_FALLBACK,
      avoid_now_text: null,
      suggested_phrase: null,
      final_text: safetyFinalText,
      share_eligible: false,
      last_inference_run_id: inferenceRunId,
    }, { onConflict: "scene_id" });

    // Audit
    await logAuditEvent(svc, {
      user_id,
      event_type: "scene.inference.blocked_risk",
      resource_type: "scene",
      resource_id: scene_id,
      metadata: { risk_level: routerOutput.risk_level, inference_run_id: inferenceRunId },
    });

    // Close job via DB function
    await svc.rpc("close_job_blocked_risk", {
      p_job_id: ctx.job.id,
      p_scene_id: scene_id,
      p_risk_level: routerOutput.risk_level,
    }).schema("app_private");

    await svc.schema("app_private").from("inference_runs").update({
      success: true,
      duration_ms: Date.now() - startTime,
    }).eq("id", inferenceRunId);

    return; // STOP — no further modules
  }

  // ===========================================================================
  // MODULE B — NORMALIZADOR DE ESCENA
  // ===========================================================================
  await svc.from("scenes").update({ processing_status: "inference_running" }).eq("id", scene_id);

  const normPrompt = `Tu tarea es estructurar una escena relacional sin interpretar demasiado.

Separa el relato en estas capas:
- hechos observables
- frases literales del usuario
- frases literales de la otra persona
- cambios posteriores en el vínculo
- emociones reportadas por el usuario
- significados o conclusiones que el usuario se armó
- conductas del usuario después del evento
- referencias a escenas previas o parecidas
- ambigüedades relevantes
- datos faltantes

Reglas:
- No diagnostiques.
- No expliques motivaciones profundas.
- No decidas quién tiene razón.
- No conviertas emoción en prueba.
- Si el usuario mezcla hecho e interpretación, conserva ambas por separado.
- Si faltan datos importantes, repórtalos como missing_data.

Devuelve sólo JSON con este formato exacto:
{
  "scene_title": "",
  "event_type": "",
  "facts": [],
  "quotes_user": [],
  "quotes_other": [],
  "post_event_change": [],
  "user_emotions": [],
  "user_meanings": [],
  "user_actions": [],
  "memory_links": [],
  "ambiguities": [],
  "missing_data": []
}`;

  const normRes = await callLLM(SYSTEM_GLOBAL, `Expediente: ${dossier.title} (${dossier.dossier_type})\n\nRelato del usuario:\n${rawNarrative}\n\n${normPrompt}`);
  const normOutput = parseLLMJson<NormalizadorOutput>(normRes.content);

  // Persist normalized scene
  await svc.schema("app_private").from("inference_runs").update({
    normalized_scene_payload: normOutput,
  }).eq("id", inferenceRunId);

  // Delete and re-insert scene_facts (idempotent)
  await svc.from("scene_facts").delete().eq("scene_id", scene_id);

  const factsToInsert = [
    ...normOutput.facts.map((t) => ({ scene_id, user_id, fact_text: t, fact_type: "observable", source: "normalizador" })),
    ...normOutput.quotes_user.map((t) => ({ scene_id, user_id, fact_text: t, fact_type: "quote_user", source: "normalizador" })),
    ...normOutput.quotes_other.map((t) => ({ scene_id, user_id, fact_text: t, fact_type: "quote_other", source: "normalizador" })),
    ...normOutput.user_actions.map((t) => ({ scene_id, user_id, fact_text: t, fact_type: "behavioral", source: "normalizador" })),
  ].filter((f) => f.fact_text?.trim());

  if (factsToInsert.length > 0) {
    await svc.from("scene_facts").insert(factsToInsert);
  }

  // Delete and re-insert scene_signals
  await svc.from("scene_signals").delete().eq("scene_id", scene_id);

  const signalsToInsert = [
    ...normOutput.user_emotions.map((t) => ({ scene_id, user_id, signal_type: "emotion", signal_text: t })),
    ...normOutput.user_meanings.map((t) => ({ scene_id, user_id, signal_type: "meaning", signal_text: t })),
    ...normOutput.ambiguities.map((t) => ({ scene_id, user_id, signal_type: "ambiguity", signal_text: t })),
    ...normOutput.missing_data.map((t) => ({ scene_id, user_id, signal_type: "missing_data", signal_text: t })),
    ...normOutput.memory_links.map((t) => ({ scene_id, user_id, signal_type: "memory_link", signal_text: t })),
  ].filter((s) => s.signal_text?.trim());

  if (signalsToInsert.length > 0) {
    await svc.from("scene_signals").insert(signalsToInsert);
  }

  // ===========================================================================
  // MODULE C — LECTOR DE EXPEDIENTE (DB — sin LLM)
  // ===========================================================================
  const recentScenesRes = await svc
    .from("scenes")
    .select("id, title, scene_type, risk_level, occurred_at, processing_status")
    .eq("dossier_id", dossier_id)
    .eq("processing_status", "ready")
    .neq("id", scene_id)
    .order("occurred_at", { ascending: false })
    .limit(5);

  const dossierContext = {
    dossier_summary: baseline?.lived_summary ?? null,
    active_patterns: activePatterns.map((p) => ({
      name: p.pattern_name,
      family: p.pattern_family,
      status: p.status,
      confidence: p.confidence,
      safe_summary: p.safe_summary,
    })),
    relevant_history: (recentScenesRes.data ?? []).map((s) => ({
      scene_type: s.scene_type,
      risk_level: s.risk_level,
      occurred_at: s.occurred_at,
    })),
    known_triggers: baseline?.main_triggers ?? [],
    known_user_sequence: baseline?.typical_user_sequence ?? [],
    things_that_helped: baseline?.things_that_help ?? [],
    things_that_worsened: baseline?.things_that_worsen ?? [],
    cross_dossier_resonances: [],
  };

  await svc.schema("app_private").from("inference_runs").update({
    dossier_context_payload: dossierContext,
  }).eq("id", inferenceRunId);

  // ===========================================================================
  // MODULE D — MOTOR DE LECTURA
  // ===========================================================================
  const lecturaPrompt = `Tu tarea es leer una escena relacional con precisión y prudencia.

Recibirás una escena estructurada, un resumen de expediente y una clasificación de seguridad.

Nivel de riesgo detectado: ${routerOutput.risk_level}
Modo sugerido por router: ${routerOutput.required_mode}

Debes producir:
1. qué sí se observa (texto claro, basado sólo en hechos)
2. qué dinámica parece más consistente con la evidencia
3. qué no está demostrado todavía
4. qué parte del usuario aparece en la secuencia
5. posibles puntos de fricción útiles
6. un nivel de confianza (0.00 a 1.00)
7. el modo de respuesta más adecuado

Puedes usar conceptos como demanda-retirada, protesta por desconexión, retirada protectora, búsqueda de certeza, culpa al poner límite, pérdida de firmeza, sobreexplicación, lectura rápida de rechazo —
pero sólo como patrones de secuencia, nunca como identidad fija.

TAMBIÉN debes estimar estas 5 variables numéricas (0.00 a 1.00):
- activation_level: nivel de activación emocional del usuario en esta escena
- evidence_density: qué tan densa es la evidencia concreta disponible
- recurrence_level: qué tanto se repite este patrón en el historial conocido
- distortion_level: cuánta distorsión cognitiva o salto interpretativo detectas
- externalization_level: cuánto el usuario externaliza la responsabilidad del ciclo

Reglas:
- No diagnostiques. No afirmes intención del otro.
- Si la evidencia es baja, la confianza debe bajar.
- Si hay mucho dato faltante, dilo en not_proven y baja confianza.
${routerOutput.risk_level === "amber" ? "- Riesgo amber: reduce certeza y evita confrontación fuerte." : ""}

Devuelve sólo JSON con este formato exacto:
{
  "observable": "",
  "probable_dynamics": [],
  "not_proven": [],
  "user_part": [],
  "friction_candidates": [],
  "confidence": 0.0,
  "recommended_mode": "S1|S2|S3|S4|S5",
  "activation_level": 0.0,
  "evidence_density": 0.0,
  "recurrence_level": 0.0,
  "distortion_level": 0.0,
  "externalization_level": 0.0
}`;

  const lecturaRes = await callLLM(
    SYSTEM_GLOBAL,
    `Escena estructurada:\n${JSON.stringify(normOutput)}\n\nContexto del expediente:\n${JSON.stringify(dossierContext)}\n\n${lecturaPrompt}`,
  );
  const lecturaOutput = parseLLMJson<LecturaOutput>(lecturaRes.content);

  // Clamp variables to [0,1]
  const clamp = (v: number) => Math.min(1, Math.max(0, v ?? 0));
  const activationLevel = clamp(lecturaOutput.activation_level);
  const evidenceDensity = clamp(lecturaOutput.evidence_density);
  const recurrenceLevel = clamp(lecturaOutput.recurrence_level);
  const distortionLevel = clamp(lecturaOutput.distortion_level);
  const externalizationLevel = clamp(lecturaOutput.externalization_level);
  const confidence = clamp(lecturaOutput.confidence);

  await svc.schema("app_private").from("inference_runs").update({
    reading_payload: lecturaOutput,
  }).eq("id", inferenceRunId);

  // Update scenes with calculated variables
  await svc.from("scenes").update({
    activation_level: activationLevel,
    evidence_density: evidenceDensity,
    recurrence_level: recurrenceLevel,
    distortion_level: distortionLevel,
    externalization_level: externalizationLevel,
    risk_level: routerOutput.risk_level,
    required_mode: lecturaOutput.recommended_mode ?? routerOutput.required_mode ?? "S2",
  }).eq("id", scene_id);

  // ===========================================================================
  // MODULE E — MOTOR DE CONFRONTACIÓN
  // ===========================================================================
  const confrontationEligibility = calcConfrontationEligibility(
    evidenceDensity,
    recurrenceLevel,
    distortionLevel,
    externalizationLevel,
    activationLevel,
    routerOutput.risk_level,
  );

  const confrontPrompt = `Tu tarea es decidir si esta escena necesita confrontación y con qué intensidad.

Confrontar significa mostrar una verdad incómoda útil para el usuario. No significa humillar, diagnosticar ni imponer un relato.

Sólo confronta si hay base en: hechos observables, contradicciones internas, recurrencia, patrones ya vistos, brecha entre evidencia y conclusión, externalización total.

No confrontes si: el usuario está demasiado activado, hay riesgo amber alto, red o black, la evidencia es baja.

Nivel de elegibilidad de confrontación calculado: ${confrontationEligibility.toFixed(3)} (0=mínima, 1=máxima)
Risk level: ${routerOutput.risk_level}
Activation level: ${activationLevel.toFixed(2)}
Evidence density: ${evidenceDensity.toFixed(2)}
Recurrence level: ${recurrenceLevel.toFixed(2)}

Escala de confrontación:
0 = sin confrontación
1 = contraste suave
2 = señalamiento de salto interpretativo
3 = espejo de contradicción
4 = sacudida estructurada
5 = límite directo por uso impropio

Reglas:
- La confrontación debe atacar la lectura, la secuencia o la conducta. NUNCA la identidad.
- Si riesgo != green, confrontation_level máximo = 1.
- Si eligibility < 0.45, no subir de 1.
- Si evidencia alta + recurrencia alta + activación media/baja, permite 3 o 4.
- Nunca produzcas: "te victimizas", "eres dependiente", "tu pareja es narcisista".

Devuelve sólo JSON con este formato exacto:
{
  "should_confront": true,
  "confrontation_level": 0,
  "core_friction": "",
  "supporting_evidence": [],
  "soft_version": "",
  "firm_version": "",
  "blocked_phrases": []
}`;

  const confrontRes = await callLLM(
    SYSTEM_GLOBAL,
    `Lectura de la escena:\n${JSON.stringify(lecturaOutput)}\n\nContexto del expediente:\n${JSON.stringify(dossierContext)}\n\n${confrontPrompt}`,
  );
  const confrontOutput = parseLLMJson<ConfrontacionOutput>(confrontRes.content);

  // Cap confrontation level
  confrontOutput.confrontation_level = capConfrontationLevel(
    confrontOutput.confrontation_level ?? 0,
    confrontationEligibility,
    routerOutput.risk_level,
  );

  await svc.schema("app_private").from("inference_runs").update({
    confrontation_payload: confrontOutput,
  }).eq("id", inferenceRunId);

  // Persist policy decisions
  await svc.schema("app_private").from("policy_decisions").insert({
    inference_run_id: inferenceRunId,
    scene_id,
    activation_level: activationLevel,
    evidence_density: evidenceDensity,
    recurrence_level: recurrenceLevel,
    distortion_level: distortionLevel,
    externalization_level: externalizationLevel,
    confrontation_eligibility: confrontationEligibility,
    required_mode: lecturaOutput.recommended_mode ?? "S2",
    allow_relational_inference: routerOutput.allow_relational_inference,
    allow_confrontation: routerOutput.allow_confrontation,
    confrontation_level: confrontOutput.confrontation_level,
    risk_level: routerOutput.risk_level,
    risk_types: routerOutput.risk_types ?? [],
  });

  // ===========================================================================
  // MODULE F — MOTOR DE MOVIMIENTO
  // ===========================================================================
  const movimientoPrompt = `Tu tarea es proponer el movimiento más útil ahora.

El movimiento debe ser: concreto, corto, no manipulador, compatible con la lectura, el riesgo y el nivel de activación.

Activation level: ${activationLevel.toFixed(2)} ${activationLevel > 0.7 ? "(alto — no sugerir acción directa inmediata)" : ""}
Risk level: ${routerOutput.risk_level}

Puede proponer: pausar, aclarar, reparar, poner límite, no entrar todavía, hablar desde hecho y necesidad, bajar una conclusión, registrar y observar.

NO propongas: controlar al otro, probar al otro, exigir alivio inmediato, usar silencio como castigo, frases para manipular emocionalmente, chantaje emocional.

La frase sugerida, si existe, debe ser: breve, limpia, no sobreexplicativa, no acusatoria, no melodramática.

Devuelve sólo JSON con este formato exacto:
{
  "internal_move": "",
  "external_move": "",
  "suggested_phrase": "",
  "avoid_now": [],
  "followup_signal_watch": []
}`;

  const movRes = await callLLM(
    SYSTEM_GLOBAL,
    `Lectura:\n${JSON.stringify(lecturaOutput)}\n\nConfrontación:\n${JSON.stringify(confrontOutput)}\n\nContexto del expediente:\n${JSON.stringify(dossierContext)}\n\n${movimientoPrompt}`,
  );
  const movOutput = parseLLMJson<MovimientoOutput>(movRes.content);

  await svc.schema("app_private").from("inference_runs").update({
    movement_payload: movOutput,
  }).eq("id", inferenceRunId);

  // ===========================================================================
  // MODULE G — ENSAMBLADOR FINAL
  // ===========================================================================
  const requiredMode = lecturaOutput.recommended_mode ?? routerOutput.required_mode ?? "S2";
  const confrontationLevel = confrontOutput.confrontation_level ?? 0;

  const ensambladorPrompt = `Tu tarea es redactar la respuesta final al usuario con la voz del producto.

Modo requerido: ${requiredMode}
Nivel de confrontación: ${confrontationLevel}/5 ${confrontationLevel === 0 ? "(sin confrontación directa)" : confrontationLevel >= 3 ? "(confrontación sustentada, no suavices en exceso)" : "(contraste suave)"}
Risk level: ${routerOutput.risk_level}

La voz debe ser: clara, firme, sobria, precisa, humana, no complaciente.
La respuesta debe sonar como un espejo estructurado — no como terapeuta de Instagram, no como amiga que da la razón por reflejo, no como bot legal.

Reglas:
- No des sermón. No uses jerga clínica innecesaria. No seas frío ni maternal.
- No halagues. No inventes nada que no venga de lectura, confrontación o movimiento.
- Bloque 7 (limit_text) NUNCA puede estar vacío.
- Si el modo es S1, usa lenguaje de contención sobria.
- Si la confrontación es baja, usa contraste limpio.
- Si la confrontación es alta y sustentada, no suavices la verdad incómoda.

Estructura obligatoria:
1. Lo que sí veo (observable_text)
2. Lo que probablemente pasa (probable_text)
3. Lo que no está probado (not_proven_text)
4. Lo que tú estás poniendo en juego (user_part_text)
5. La fricción aquí (friction_text — aquí va la confrontación si aplica)
6. Lo más útil ahora (movement_text)
7. Lo que no voy a hacer (limit_text — NUNCA vacío, marca el límite del sistema)

La respuesta debe dejar al usuario sintiendo: "no me consintió, no me humilló, pero sí me mostró algo que no quería ver."

Devuelve sólo JSON con este formato exacto:
{
  "observable_text": "",
  "probable_text": "",
  "not_proven_text": "",
  "user_part_text": "",
  "friction_text": "",
  "movement_text": "",
  "limit_text": "",
  "avoid_now_text": "",
  "suggested_phrase": "",
  "final_text": ""
}

where final_text es una síntesis completa de todos los bloques como texto corrido para presentación directa al usuario.`;

  const ensRes = await callLLM(
    SYSTEM_GLOBAL,
    `Lectura:\n${JSON.stringify(lecturaOutput)}\n\nConfrontación:\n${JSON.stringify(confrontOutput)}\n\nMovimiento:\n${JSON.stringify(movOutput)}\n\n${ensambladorPrompt}`,
  );
  const ensOutput = parseLLMJson<EnsambladorOutput>(ensRes.content);

  // Enforce limit_text non-empty
  if (!ensOutput.limit_text?.trim()) {
    ensOutput.limit_text = LIMIT_TEXT_FALLBACK;
  }
  // Enforce final_text non-empty
  if (!ensOutput.final_text?.trim()) {
    ensOutput.final_text = [
      ensOutput.observable_text,
      ensOutput.probable_text,
      ensOutput.not_proven_text,
      ensOutput.movement_text,
      ensOutput.limit_text,
    ].filter(Boolean).join("\n\n");
  }

  const shareEligible = routerOutput.risk_level === "green" && confidence >= 0.4;

  // Upsert scene_outputs
  await svc.from("scene_outputs").upsert({
    scene_id,
    user_id,
    mode: requiredMode as "S0" | "S1" | "S2" | "S3" | "S4" | "S5",
    risk_level: routerOutput.risk_level as "green" | "amber" | "red" | "black",
    confidence,
    observable_text: ensOutput.observable_text ?? null,
    probable_text: ensOutput.probable_text ?? null,
    not_proven_text: ensOutput.not_proven_text ?? null,
    user_part_text: ensOutput.user_part_text ?? null,
    friction_text: ensOutput.friction_text ?? null,
    movement_text: ensOutput.movement_text ?? null,
    limit_text: ensOutput.limit_text,
    avoid_now_text: ensOutput.avoid_now_text ?? null,
    suggested_phrase: ensOutput.suggested_phrase ?? movOutput.suggested_phrase ?? null,
    final_text: ensOutput.final_text,
    share_eligible: shareEligible,
    last_inference_run_id: inferenceRunId,
  }, { onConflict: "scene_id" });

  // Persist assembly in response_assemblies
  await svc.schema("app_private").from("response_assemblies").insert({
    inference_run_id: inferenceRunId,
    scene_id,
    block_1_observable: ensOutput.observable_text,
    block_2_probable: ensOutput.probable_text,
    block_3_not_proven: ensOutput.not_proven_text,
    block_4_user_part: ensOutput.user_part_text,
    block_5_friction: ensOutput.friction_text,
    block_6_movement: ensOutput.movement_text,
    block_7_limit: ensOutput.limit_text,
  });

  await svc.schema("app_private").from("inference_runs").update({
    assembly_payload: ensOutput,
    final_text: ensOutput.final_text,
  }).eq("id", inferenceRunId);

  // Persist intervention
  await svc.from("interventions").insert({
    scene_id,
    dossier_id,
    user_id,
    internal_move: movOutput.internal_move ?? null,
    external_move: movOutput.external_move ?? null,
    suggested_phrase: movOutput.suggested_phrase ?? null,
    avoid_now: movOutput.avoid_now ?? [],
    followup_signal_watch: movOutput.followup_signal_watch ?? [],
    status: "suggested",
  });

  // ===========================================================================
  // MODULE H — ACTUALIZACIÓN DE PATRONES (sin LLM)
  // ===========================================================================
  if (routerOutput.risk_level === "green") {
    const patternCandidates = [
      ...lecturaOutput.probable_dynamics ?? [],
      ...lecturaOutput.friction_candidates ?? [],
    ].filter(Boolean).slice(0, 5);

    for (const dynamicText of patternCandidates) {
      // Normalize: use first ~60 chars as pattern_name key
      const patternName = dynamicText.substring(0, 80).trim();
      const patternFamily = inferPatternFamily(dynamicText);

      // Look for existing pattern
      const { data: existingPatterns } = await svc
        .from("patterns")
        .select("id, evidence_count, status")
        .eq("dossier_id", dossier_id)
        .eq("pattern_name", patternName)
        .limit(1);

      let patternId: string;

      if (existingPatterns && existingPatterns.length > 0) {
        const existing = existingPatterns[0];
        const newCount = (existing.evidence_count ?? 0) + 1;
        const newStatus = resolvePatternStatus(newCount, routerOutput.risk_level);
        const newConfidence = calcPatternConfidence(newCount);

        await svc.from("patterns").update({
          evidence_count: newCount,
          status: newStatus,
          confidence: newConfidence,
          safe_summary: lecturaOutput.observable ?? dynamicText,
        }).eq("id", existing.id);

        patternId = existing.id as string;
      } else {
        const { data: newPattern } = await svc.from("patterns").insert({
          dossier_id,
          user_id,
          pattern_family: patternFamily,
          pattern_name: patternName,
          status: "candidate",
          confidence: calcPatternConfidence(1),
          evidence_count: 1,
          safe_summary: lecturaOutput.observable ?? dynamicText,
          blocked_summary: JSON.stringify({
            probable_dynamics: lecturaOutput.probable_dynamics,
            friction: confrontOutput.core_friction,
          }),
        }).select("id").single();

        if (!newPattern) continue;
        patternId = newPattern.id as string;
      }

      // Link evidence
      await svc.from("pattern_evidence").upsert({
        pattern_id: patternId,
        scene_id,
        user_id,
        weight: evidenceDensity,
        rationale: dynamicText,
      }, { onConflict: "pattern_id,scene_id", ignoreDuplicates: true });
    }
  }

  // ===========================================================================
  // CLOSE JOB
  // ===========================================================================
  await svc.schema("app_private").from("inference_runs").update({
    success: true,
    duration_ms: Date.now() - startTime,
  }).eq("id", inferenceRunId);

  await logAuditEvent(svc, {
    user_id,
    event_type: "scene.inference.completed",
    resource_type: "scene",
    resource_id: scene_id,
    metadata: {
      inference_run_id: inferenceRunId,
      risk_level: routerOutput.risk_level,
      confidence,
      mode: requiredMode,
      duration_ms: Date.now() - startTime,
    },
  });

  await svc.rpc("complete_job", {
    p_job_id: ctx.job.id,
    p_scene_id: scene_id,
  }).schema("app_private");
}

// =============================================================================
// HELPERS
// =============================================================================

async function markFailed(
  svc: SupabaseClient,
  jobId: string,
  sceneId: string,
  code: string,
  message: string,
) {
  await svc.rpc("fail_job", {
    p_job_id: jobId,
    p_scene_id: sceneId,
    p_error_message: message.substring(0, 500),
    p_error_code: code,
  }).schema("app_private");
}

function inferPatternFamily(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("retirada") || t.includes("demanda") || t.includes("persecución") || t.includes("distancia")) return "conflict_cycle";
  if (t.includes("apego") || t.includes("abandono") || t.includes("ansiedad") || t.includes("protesta")) return "attachment";
  if (t.includes("límite") || t.includes("culpa") || t.includes("fusión") || t.includes("autoridad")) return "differentiation";
  if (t.includes("sex") || t.includes("deseo") || t.includes("vergüenza")) return "sexual_relational";
  if (t.includes("resonan") || t.includes("parecido") || t.includes("similar")) return "resonance";
  return "conflict_cycle";
}
