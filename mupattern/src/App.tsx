import { useEffect } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import WorkspaceLanding from "@/workspace/WorkspaceLanding"
import WorkspaceDashboard from "@/workspace/WorkspaceDashboard"
import RegisterApp from "@/register/RegisterApp"
import SeeApp from "@/see/SeeApp"
import {
  workspaceStore,
  restoreDirHandle,
  getDirHandle,
} from "@/workspace/store"

function InitHandles() {
  useEffect(() => {
    for (const w of workspaceStore.state.workspaces) {
      if (!getDirHandle(w.id)) restoreDirHandle(w.id).then(() => {})
    }
  }, [])
  return null
}

function App() {
  return (
    <BrowserRouter>
      <InitHandles />
      <Routes>
        <Route path="/" element={<WorkspaceLanding />} />
        <Route path="/workspace" element={<WorkspaceDashboard />} />
        <Route path="/register" element={<RegisterApp />} />
        <Route path="/see" element={<SeeApp />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
