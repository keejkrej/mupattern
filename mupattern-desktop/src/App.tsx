import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { useStore } from "@tanstack/react-store";
import WorkspaceDashboard from "@/workspace/WorkspaceDashboard";
import RegisterApp from "@/register/RegisterApp";
import SeeApp from "@/see/SeeApp";
import TasksDashboardPage from "@/tasks/TasksDashboardPage";
import ApplicationApp from "@/application/ApplicationApp";
import { appStore } from "@/register/store";
import { workspaceStore } from "@/workspace/store";

function WorkspaceOnlyRoute({
  children,
  requireStarted = false,
}: {
  children: React.ReactElement;
  requireStarted?: boolean;
}) {
  const activeId = useStore(workspaceStore, (s) => s.activeId);
  const started = useStore(appStore, (s) => s.started);
  if (!activeId) {
    return <Navigate to="/workspace" replace />;
  }
  if (requireStarted && !started) {
    return <Navigate to="/workspace" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-full">
        <Toaster richColors position="bottom-right" />
        <Routes>
          <Route path="/" element={<WorkspaceDashboard />} />
          <Route path="/workspace" element={<WorkspaceDashboard />} />
          <Route
            path="/register"
            element={
              <WorkspaceOnlyRoute>
                <RegisterApp />
              </WorkspaceOnlyRoute>
            }
          />
          <Route
            path="/see"
            element={
              <WorkspaceOnlyRoute>
                <SeeApp />
              </WorkspaceOnlyRoute>
            }
          />
          <Route path="/tasks" element={<TasksDashboardPage />} />
          <Route
            path="/application"
            element={
              <WorkspaceOnlyRoute>
                <ApplicationApp />
              </WorkspaceOnlyRoute>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
