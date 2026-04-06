import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import Splash from "./screens/Splash";
import Login from "./screens/Login";
import Dossiers from "./screens/Dossiers";
import CreateDossier from "./screens/CreateDossier";
import Scenes from "./screens/Scenes";
import SceneForm from "./screens/SceneForm";
import SceneStatus from "./screens/SceneStatus";
import SceneBundle from "./screens/SceneBundle";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/login" element={<Login />} />

        <Route path="/dossiers" element={<RequireAuth><Dossiers /></RequireAuth>} />
        <Route path="/dossiers/new" element={<RequireAuth><CreateDossier /></RequireAuth>} />
        <Route path="/dossiers/:dossierId/scenes" element={<RequireAuth><Scenes /></RequireAuth>} />
        <Route path="/dossiers/:dossierId/scenes/new" element={<RequireAuth><SceneForm /></RequireAuth>} />

        <Route path="/scenes/:sceneId/status" element={<RequireAuth><SceneStatus /></RequireAuth>} />
        <Route path="/scenes/:sceneId/bundle" element={<RequireAuth><SceneBundle /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
