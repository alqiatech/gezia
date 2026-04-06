import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, callFunction } from "../lib/supabase";

const RELATIONSHIP_TYPES = [
  "romantic_partner",
  "ex_partner",
  "parent",
  "child",
  "sibling",
  "friend",
  "coworker",
  "other",
];

export default function CreateDossier() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [relType, setRelType] = useState("romantic_partner");
  const [contextNote, setContextNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setError("");
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesion expirada");

      await callFunction(
        "create-dossier",
        {
          client_request_id: crypto.randomUUID(),
          title: title.trim(),
          relationship_type: relType,
          context_note: contextNote.trim() || undefined,
        },
        session.access_token
      );

      navigate("/dossiers", { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al crear expediente");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen">
      <div className="nav-bar" style={{ padding: 0 }}>
        <button className="nav-back" onClick={() => navigate("/dossiers")}>&larr; Expedientes</button>
      </div>

      <div className="screen-title">Nuevo expediente</div>
      <div className="screen-sub">Define el contexto de esta relacion.</div>

      <div className="field">
        <label>Nombre del expediente</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej. Con Daniel, Con mama..."
          maxLength={80}
        />
      </div>

      <div className="field">
        <label>Tipo de relacion</label>
        <select value={relType} onChange={(e) => setRelType(e.target.value)}>
          {RELATIONSHIP_TYPES.map((r) => (
            <option key={r} value={r}>{r.replace("_", " ")}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Contexto (opcional)</label>
        <textarea
          value={contextNote}
          onChange={(e) => setContextNote(e.target.value)}
          placeholder="Algo que quieras recordar sobre este contexto..."
          maxLength={500}
        />
      </div>

      {error && <div className="error-box">{error}</div>}

      <button
        className="btn btn-primary"
        onClick={create}
        disabled={loading || !title.trim()}
        style={{ marginTop: "auto" }}
      >
        {loading ? <div className="spinner" style={{ width: 18, height: 18, margin: "0 auto" }} /> : "Crear expediente"}
      </button>
    </div>
  );
}
