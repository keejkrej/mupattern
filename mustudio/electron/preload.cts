import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("mustudio", {
  platform: process.platform,
  workspaceState: {
    load: () => ipcRenderer.invoke("workspace-state:load"),
    save: (state: unknown) => ipcRenderer.invoke("workspace-state:save", state),
  },
  workspace: {
    pickDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
    readPositionImage: (request: unknown) =>
      ipcRenderer.invoke("workspace:read-position-image", request),
    saveBboxCsv: (request: unknown) =>
      ipcRenderer.invoke("workspace:save-bbox-csv", request),
  },
  zarr: {
    discover: (request: unknown) => ipcRenderer.invoke("zarr:discover", request),
    loadFrame: (request: unknown) => ipcRenderer.invoke("zarr:load-frame", request),
  },
})
