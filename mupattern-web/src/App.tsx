import { lazy, Suspense } from "react";
import { useStore } from "@tanstack/react-store";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { mupatternStore } from "@/store/mupattern-store";

const Landing = lazy(() => import("@/Landing"));
const Tools = lazy(() => import("@/Tools"));
const Download = lazy(() => import("@/Download"));
const RegisterApp = lazy(() => import("@/register/RegisterApp"));
const SeeApp = lazy(() => import("@/see/SeeApp"));

function RegisterRoute({ children }: { children: React.ReactElement }) {
  const started = useStore(mupatternStore, (s) => s.register.started);
  if (!started) return <Navigate to="/tools" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-full">
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/download" element={<Download />} />
            <Route
              path="/register"
              element={
                <RegisterRoute>
                  <RegisterApp />
                </RegisterRoute>
              }
            />
            <Route path="/see" element={<SeeApp />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
