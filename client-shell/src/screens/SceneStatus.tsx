import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

const POLL_INTERVAL = 3000; // 3s

export default function SceneStatus() {
  const { sceneId } = useParams<{ sceneId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>("queued");
  const [riskLevel, setRiskLevel] = useState<string | null>(null);
  const [dossierId, setDossierId] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const { data, error: err } = await supabase
        .from("scenes")
        .select("processing_status, risk_level, dossier_id")
        .eq("id", sceneId)
        .single();

      if (err) { setError(err.message); return; }
      if (!data) { setError("Escena no encontrada"); return; }

      setStatus(data.processing_status);
      setRiskLevel(data.risk_level ?? null);
      setDossierId(data.dossier_id);

      if (data.processing_status === "completed") {
        navigate(`/scenes/${sceneId}/bundle`, { replace: true });
        return;
      }

      if (data.processing_status === "failed") return; // stop polling

      timer = setTimeout(poll, POLL_INTERVAL);
    };

    poll();
    return () => clearTimeout(timer);
  }, [sceneId, navigate]);

  const statusLabel: Record<string, string> = {
    submitted: "Enviado — en espera de proceso",
    queued: "En cola de analisis...",
    processing: "Analizando la escena...",
    failed: "El proceso fallo",
    blocked_risk: "Escena bloqueada por nivel de riesgo",
  };

  const statusClass: Record<string, string> = {
    submitted: "status-submitted",
    queued: "status-queued",
    processing: "status-running",
    failed: "status-failed",
    blocked_risk: "status-failed",
  };

  return (
    <div className="screen" style={{ alignItems: "center", justifyContent: "center" }}>
      {status !== "failed" && status !== "blocked_risk" && (
        <div className="spinner" style={{ width: 36, height: 36 }} />
      )}

      <div style={{ textAlign: "center", gap: 8, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span className={`status-badge ${statusClass[status] ?? "status-submitted"}`} style={{ fontSize: 13 }}>
          {status}
        </span>
        <div className="screen-sub">
          {statusLabel[status] ?? "Procesando..."}
        </div>
      </div>

      {riskLevel && riskLevel !== "green" && (
        <div style={{ background: "var(--mist)", border: "1.5px solid var(--slate)", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 13, color: "var(--deep)" }}>
          Nivel de riesgo detectado: <strong>{riskLevel}</strong>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {(status === "failed" || status === "blocked_risk") && (
        <button
          className="btn btn-secondary"
          onClick={() => navigate(`/dossiers/${dossierId}/scenes`)}
        >
          Volver al expediente
        </button>
      )}
    </div>
  );
}
