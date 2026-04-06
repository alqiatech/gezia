import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      setTimeout(() => {
        navigate(data.session ? "/dossiers" : "/login", { replace: true });
      }, 1400);
    };
    check();
  }, [navigate]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--deep)",
        gap: 20,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: "var(--mist)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 32, color: "var(--deep)", fontWeight: 700 }}>G</span>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: "var(--sand)", letterSpacing: -0.5 }}>
          GEZIA
        </div>
        <div style={{ fontSize: 13, color: "var(--mist)", marginTop: 4, letterSpacing: 0.5 }}>
          Claridad Afectiva
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        <div className="spinner" style={{ borderTopColor: "var(--mist)", borderColor: "rgba(255,255,255,0.2)" }} />
      </div>
    </div>
  );
}
