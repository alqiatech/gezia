import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Dossier = {
  id: string;
  title: string;
  relationship_type: string;
  created_at: string;
};

export default function Dossiers() {
  const navigate = useNavigate();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase
      .from("dossiers")
      .select("id, title, relationship_type, created_at")
      .order("created_at", { ascending: false });

    if (err) setError(err.message);
    else setDossiers(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="screen">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="screen-title">Expedientes</div>
          <div className="screen-sub">{dossiers.length} expediente{dossiers.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn btn-ghost" onClick={logout}>Salir</button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div style={{ paddingTop: 32 }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          {dossiers.length === 0 && (
            <div className="screen-sub" style={{ textAlign: "center", paddingTop: 32 }}>
              Sin expedientes aun. Crea el primero.
            </div>
          )}

          {dossiers.map((d) => (
            <div
              key={d.id}
              className="card"
              onClick={() => navigate(`/dossiers/${d.id}/scenes`)}
            >
              <div className="card-title">{d.title}</div>
              <div className="card-sub">
                <span className="tag">{d.relationship_type}</span>
              </div>
            </div>
          ))}

          <button
            className="btn btn-secondary"
            style={{ marginTop: "auto" }}
            onClick={() => navigate("/dossiers/new")}
          >
            Nuevo expediente
          </button>
        </>
      )}
    </div>
  );
}
