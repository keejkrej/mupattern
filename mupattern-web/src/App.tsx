import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useStore } from "@tanstack/react-store";
import Landing from "@/Landing";
import RegisterApp from "@/register/RegisterApp";
import SeeApp from "@/see/SeeApp";
import { mupatternStore } from "@/store/mupattern-store";

function RegisterRoute({ children }: { children: React.ReactElement }) {
  const started = useStore(mupatternStore, (s) => s.register.started);
  if (!started) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-full">
        <Routes>
          <Route path="/" element={<Landing />} />
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
      </div>
    </BrowserRouter>
  );
}

export default App;
