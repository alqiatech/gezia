import { useEffect, useState, ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setChecked(true);
    });
  }, []);

  if (!checked) return null;
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}
