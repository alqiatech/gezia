import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, callFunctionGet } from "../lib/supabase";

type SceneBundle = {
  scene: {
    id: string;
    dossier_id: string;
    risk_level: string;
    confrontation_level: number;
    processing_status: string;
  };
  output: {
    block1_texto: string;
    block2_texto: string;
    block3_texto: string;
    block4_texto: string;
    block5_texto: string;
    block6_texto: string;
    block7_texto: string;
    final_text: string;
  } | null;
  interventions: Array<{ id: string; description: string; tags: string[] }>;
  safety_flag: boolean;
};

const BLOCK_LABELS: Record<string, string> = {
  block1_texto: "Lo que observo",
  block2_texto: "Lo que puedo hacer",
  block3_texto: "Lo que siento",
  block4_texto: "Patron",
  block5_texto: "Confrontacion",
  block6_texto: "Movimiento posible",
  block7_texto: "Desde donde puedes mirar esto",
};

export default function SceneBundle() {
  const { sceneId } = useParams<{ sceneId: string }>();
  const navigate = useNavigate();
  const [bundle, setBundle] = useState<SceneBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }

      try {
        const data = await callFunctionGet<SceneBundle>(
          "get-scene-bundle",
          session.access_token,
          { scene_id: sceneId! }
        );
        setBundle(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Error al cargar resultado");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sceneId, navigate]);

  if (loading) {
    return (
      <div className="screen" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen">
        <div className="error-box">{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate("/dossiers")}>Volver</button>
      </div>
    );
  }

  if (!bundle) return null;

  const output = bundle.output;
  const dossierId = bundle.scene?.dossier_id;

  return (
    <div className="screen">
      <div className="nav-bar" style={{ padding: 0 }}>
        <button className="nav-back" onClick={() => navigate(`/dossiers/${dossierId}/scenes`)}>&larr; Escenas</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="screen-title">Resultado</div>
        {bundle.scene?.risk_level && (
          <span className="tag">{bundle.scene.risk_level}</span>
        )}
        {bundle.safety_flag && (
          <span className="tag" style={{ background: "#fdf0f0", color: "var(--danger)" }}>indicador activo</span>
        )}
      </div>

      {bundle.scene?.confrontation_level != null && (
        <div className="screen-sub">Nivel de confrontacion: {bundle.scene.confrontation_level}</div>
      )}

      {output?.final_text && (
        <div className="output-block" style={{ borderLeftColor: "var(--amber)" }}>
          <div className="output-label">Lectura completa</div>
          {output.final_text}
        </div>
      )}

      <div className="divider" />

      {output && Object.entries(BLOCK_LABELS).map(([key, label]) => {
        const text = output[key as keyof typeof output] as string;
        if (!text) return null;
        return (
          <div key={key} className="output-block">
            <div className="output-label">{label}</div>
            {text}
          </div>
        );
      })}

      {bundle.interventions?.length > 0 && (
        <>
          <div className="divider" />
          <div className="screen-sub" style={{ fontWeight: 600, color: "var(--deep)" }}>
            Intervenciones sugeridas
          </div>
          {bundle.interventions.map((iv) => (
            <div key={iv.id} className="output-block" style={{ borderLeftColor: "var(--mist)" }}>
              {iv.description}
              <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {iv.tags?.map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
            </div>
          ))}
        </>
      )}

      <button
        className="btn btn-secondary"
        style={{ marginTop: "auto" }}
        onClick={() => navigate(`/dossiers/${dossierId}/scenes`)}
      >
        Volver al expediente
      </button>
    </div>
  );
}
