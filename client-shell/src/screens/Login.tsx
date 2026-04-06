import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, callFunction } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");

  const handle = async () => {
    setError("");
    setLoading(true);
    try {
      let session;

      if (mode === "signup") {
        const { data, error: signUpErr } = await supabase.auth.signUp({ email, password });
        if (signUpErr) throw signUpErr;
        if (!data.session) {
          setError("Cuenta creada. Revisa tu correo para confirmar antes de entrar.");
          setLoading(false);
          return;
        }
        session = data.session;
      } else {
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
        session = data.session;
      }

      // bootstrap-user: idempotente, crea perfil si no existe
      await callFunction("bootstrap-user", {}, session.access_token);

      navigate("/dossiers", { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen" style={{ justifyContent: "center", flex: 1 }}>
      <div style={{ marginBottom: 8 }}>
        <div className="screen-title">{mode === "login" ? "Entrar" : "Crear cuenta"}</div>
        <div className="screen-sub" style={{ marginTop: 4 }}>
          {mode === "login" ? "Accede a tu espacio de claridad." : "Crea tu cuenta para comenzar."}
        </div>
      </div>

      <div className="field">
        <label>Correo</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com"
          autoComplete="email"
        />
      </div>

      <div className="field">
        <label>Contrasena</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="min. 8 caracteres"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onKeyDown={(e) => e.key === "Enter" && handle()}
        />
      </div>

      {error && <div className="error-box">{error}</div>}

      <button className="btn btn-primary" onClick={handle} disabled={loading || !email || !password}>
        {loading ? <div className="spinner" style={{ width: 18, height: 18, margin: "0 auto" }} /> : mode === "login" ? "Entrar" : "Crear cuenta"}
      </button>

      <button
        className="btn btn-ghost"
        style={{ textAlign: "center" }}
        onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
      >
        {mode === "login" ? "No tengo cuenta — crear una" : "Ya tengo cuenta — entrar"}
      </button>
    </div>
  );
}
