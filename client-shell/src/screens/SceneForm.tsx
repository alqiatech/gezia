import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, callFunction } from "../lib/supabase";

export default function SceneForm() {
  const { dossierId } = useParams<{ dossierId: string }>();
  const navigate = useNavigate();

  const [narrative, setNarrative] = useState("");
  const [sceneDate, setSceneDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesion expirada");

      const result = await callFunction<{ scene_id: string }>(
        "submit-scene",
        {
          client_request_id: crypto.randomUUID(),
          dossier_id: dossierId,
          raw_user_narrative: narrative.trim(),
          scene_date: sceneDate,
        },
        session.access_token
      );

      navigate(`/scenes/${result.scene_id}/status`, { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al enviar escena");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen">
      <div className="nav-bar" style={{ padding: 0 }}>
        <button className="nav-back" onClick={() => navigate(-1)}>&larr; Atras</button>
      </div>

      <div className="screen-title">Capturar escena</div>
      <div className="screen-sub">
        Describe lo que sucedio. No lo edites — escribe como recuerdas.
      </div>

      <div className="field">
        <label>Fecha de la escena</label>
        <input
          type="date"
          value={sceneDate}
          onChange={(e) => setSceneDate(e.target.value)}
        />
      </div>

      <div className="field">
        <label>Que paso</label>
        <textarea
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="Escribe con tus propias palabras lo que ocurrio..."
          style={{ minHeight: 200 }}
          maxLength={8000}
        />
        <div style={{ fontSize: 12, color: "var(--slate)", textAlign: "right" }}>
          {narrative.length} / 8000
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <button
        className="btn btn-primary"
        onClick={submit}
        disabled={loading || narrative.trim().length < 20}
        style={{ marginTop: "auto" }}
      >
        {loading
          ? <div className="spinner" style={{ width: 18, height: 18, margin: "0 auto" }} />
          : "Enviar a analisis"}
      </button>

      {narrative.trim().length < 20 && narrative.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--slate)", textAlign: "center" }}>
          Escribe al menos 20 caracteres.
        </div>
      )}
    </div>
  );
}
