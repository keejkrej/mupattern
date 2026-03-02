import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { useStore } from "@tanstack/react-store";
import { appStore } from "@/register/store";
import { workspaceStore } from "@/workspace/store";

const WorkspaceDashboard = lazy(() => import("@/workspace/WorkspaceDashboard"));
const RegisterApp = lazy(() => import("@/register/RegisterApp"));
const SeeApp = lazy(() => import("@/see/SeeApp"));
const TasksDashboardPage = lazy(() => import("@/tasks/TasksDashboardPage"));
const ApplicationApp = lazy(() => import("@/application/ApplicationApp"));

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
    <HashRouter>
      <div className="min-h-full">
        <Toaster richColors position="bottom-right" />
        <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading…</div>}>
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
        </Suspense>
      </div>
    </HashRouter>
  );
}

export default App;
