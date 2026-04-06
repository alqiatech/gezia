import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Scene = {
  id: string;
  processing_status: string;
  risk_level: string | null;
  created_at: string;
};

export default function Scenes() {
  const { dossierId } = useParams<{ dossierId: string }>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [dossierTitle, setDossierTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    const { data: d } = await supabase
      .from("dossiers")
      .select("title")
      .eq("id", dossierId)
      .single();
    if (d) setDossierTitle(d.title);

    const { data, error: err } = await supabase
      .from("scenes")
      .select("id, processing_status, risk_level, created_at")
      .eq("dossier_id", dossierId)
      .order("created_at", { ascending: false });

    if (err) setError(err.message);
    else setScenes(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [dossierId]);

  const statusClass = (s: string) => {
    if (s === "completed") return "status-completed";
    if (s === "queued" || s === "submitted") return "status-queued";
    if (s === "processing") return "status-running";
    if (s === "failed") return "status-failed";
    return "status-submitted";
  };

  return (
    <div className="screen">
      <div className="nav-bar" style={{ padding: 0 }}>
        <button className="nav-back" onClick={() => navigate("/dossiers")}>&larr; Expedientes</button>
      </div>

      <div className="screen-title">{dossierTitle || "Escenas"}</div>
      <div className="screen-sub">{scenes.length} escena{scenes.length !== 1 ? "s" : ""} registrada{scenes.length !== 1 ? "s" : ""}</div>

      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div style={{ paddingTop: 32 }}><div className="spinner" /></div>
      ) : (
        <>
          {scenes.length === 0 && (
            <div className="screen-sub" style={{ textAlign: "center", paddingTop: 32 }}>
              Sin escenas aun. Captura la primera.
            </div>
          )}

          {scenes.map((s) => (
            <div
              key={s.id}
              className="card"
              onClick={() =>
                s.processing_status === "completed"
                  ? navigate(`/scenes/${s.id}/bundle`)
                  : navigate(`/scenes/${s.id}/status`)
              }
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="card-title" style={{ fontSize: 13, color: "var(--slate)" }}>
                  {new Date(s.created_at).toLocaleDateString("es-MX", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </div>
                <span className={`status-badge ${statusClass(s.processing_status)}`}>
                  {s.processing_status}
                </span>
              </div>
              {s.risk_level && (
                <div className="card-sub">
                  <span className="tag">{s.risk_level}</span>
                </div>
              )}
            </div>
          ))}

          <button
            className="btn btn-secondary"
            style={{ marginTop: "auto" }}
            onClick={() => navigate(`/dossiers/${dossierId}/scenes/new`)}
          >
            Capturar escena
          </button>
        </>
      )}
    </div>
  );
}
