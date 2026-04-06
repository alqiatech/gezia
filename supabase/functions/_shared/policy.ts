/**
 * GEZIA — Policy Engine
 * Fórmulas de negocio del motor: confrontación, modo, umbrales.
 */

// =============================================================================
// CONFRONTATION ELIGIBILITY
// =============================================================================
// Fórmula canónica definida en POLICY ENGINE V1:
// confrontation_eligibility =
//   evidence_density × 0.35 +
//   recurrence_level × 0.20 +
//   distortion_level × 0.20 +
//   externalization_level × 0.15 +
//   (1 - activation_level) × 0.10
//
// = 0.00 obligatoriamente si risk_level es 'red' o 'black'.
// =============================================================================

export function calcConfrontationEligibility(
  evidenceDensity: number,
  recurrenceLevel: number,
  distortionLevel: number,
  externalizationLevel: number,
  activationLevel: number,
  riskLevel: string,
): number {
  if (riskLevel === "red" || riskLevel === "black") return 0.0;

  const raw =
    evidenceDensity * 0.35 +
    recurrenceLevel * 0.20 +
    distortionLevel * 0.20 +
    externalizationLevel * 0.15 +
    (1 - activationLevel) * 0.10;

  return Math.max(0, Math.min(1, parseFloat(raw.toFixed(4))));
}

// =============================================================================
// CONFRONTATION LEVEL CAP
// Limita el nivel máximo de confrontación según riesgo y eligibilidad.
// =============================================================================

export function capConfrontationLevel(
  rawLevel: number,
  confrontationEligibility: number,
  riskLevel: string,
): number {
  if (riskLevel === "red" || riskLevel === "black") return 0;
  if (riskLevel === "amber") return Math.min(rawLevel, 1);
  if (confrontationEligibility < 0.45) return Math.min(rawLevel, 1);
  if (confrontationEligibility < 0.65) return Math.min(rawLevel, 3);
  return Math.min(rawLevel, 4); // nivel 5 sólo por uso litigioso detectado por el motor
}

// =============================================================================
// PATTERN CONFIDENCE
// Calcula confianza del patrón en función del número de evidencias.
// =============================================================================

export function calcPatternConfidence(evidenceCount: number): number {
  if (evidenceCount <= 0) return 0.0;
  if (evidenceCount === 1) return 0.40;
  if (evidenceCount === 2) return 0.55;
  if (evidenceCount === 3) return 0.70;
  if (evidenceCount === 4) return 0.80;
  return Math.min(0.95, 0.80 + (evidenceCount - 4) * 0.03);
}

// =============================================================================
// PATTERN STATUS
// =============================================================================

export function resolvePatternStatus(
  evidenceCount: number,
  riskLevel: string,
): "candidate" | "confirmed" | "blocked_by_risk" {
  if (riskLevel === "red" || riskLevel === "black") return "blocked_by_risk";
  if (evidenceCount >= 3) return "confirmed";
  return "candidate";
}

// =============================================================================
// LIMIT TEXT FALLBACK
// Block 7 NUNCA puede estar vacío.
// =============================================================================

export const LIMIT_TEXT_FALLBACK =
  "No puedo concluir más allá de lo que muestran los hechos. " +
  "Hay partes de este vínculo que sólo van a aclararse con el tiempo y la observación directa. " +
  "Trabajar desde la suposición en lugar de la evidencia puede generar más confusión que claridad.";
