import { useState, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { HexBackground } from "@/components/HexBackground"
import { ThemeToggle } from "@/components/ThemeToggle"
import { useTheme } from "@/components/ThemeProvider"
import { Microscope, Eye } from "lucide-react"
import { loadImageFile, imageToDataURL } from "@/lib/load-image"
import { startWithImage } from "@/register/store"
import { setSeeSession } from "@/lib/see-session"
import { DirectoryStore } from "@/see/lib/directory-store"
import { listPositions } from "@/see/lib/zarr"

export default function Landing() {
  const { theme } = useTheme()
  const navigate = useNavigate()
  const registerInputRef = useRef<HTMLInputElement>(null)

  const [registerLoading, setRegisterLoading] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [seeLoading, setSeeLoading] = useState(false)
  const [seeError, setSeeError] = useState<string | null>(null)

  const handleRegisterFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setRegisterLoading(true)
      setRegisterError(null)
      try {
        const { image, filename } = await loadImageFile(file)
        const dataURL = imageToDataURL(image)
        startWithImage(dataURL, filename, image.width, image.height)
        navigate("/register")
      } catch (err) {
        setRegisterError(err instanceof Error ? err.message : String(err))
      } finally {
        setRegisterLoading(false)
        e.target.value = ""
      }
    },
    [navigate]
  )

  const handleSeeFolder = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== "function") {
      setSeeError("See requires Chrome or Edge. Safari and Firefox are not supported.")
      return
    }
    setSeeLoading(true)
    setSeeError(null)
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" })
      const store = new DirectoryStore(handle)
      const positions = await listPositions(handle)
      if (positions.length === 0) {
        setSeeError("No positions found. Expected layout: pos/{id}/crop/{id}/")
        setSeeLoading(false)
        return
      }
      setSeeSession({ store, dirHandle: handle, availablePositions: positions })
      navigate("/see")
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") {
        setSeeError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setSeeLoading(false)
    }
  }, [navigate])

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="text-center">
        <h1
          className="text-4xl tracking-tight"
          style={{ fontFamily: '"Bitcount", monospace' }}
        >
          MuPattern
        </h1>
        <p className="text-muted-foreground mt-1 text-center max-w-md">
          Microscopy micropattern tools
        </p>
      </div>

      <div className="flex gap-6 max-w-2xl w-full px-6">
        <div className="flex-1 border rounded-lg p-8 backdrop-blur-sm bg-background/80">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <Microscope className="size-12 text-muted-foreground flex-shrink-0" />
              <p className="font-medium">
                {registerLoading ? "Loading..." : "Register"}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Microscopy pattern-to-image registration.
            </p>
            <input
              ref={registerInputRef}
              type="file"
              accept="image/png,image/tiff,.tif,.tiff"
              onChange={handleRegisterFile}
              className="hidden"
            />
            <Button
              onClick={() => registerInputRef.current?.click()}
              disabled={registerLoading}
              className="w-full"
            >
              Choose file
            </Button>
          </div>
          {registerError && (
            <p className="text-destructive text-sm">{registerError}</p>
          )}
        </div>
        <div className="flex-1 border rounded-lg p-8 backdrop-blur-sm bg-background/80">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <Eye className="size-12 text-muted-foreground flex-shrink-0" />
              <p className="font-medium">
                {seeLoading ? "Loading..." : "See"}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Open crops.zarr to browse micropattern crops.
            </p>
            <Button
              onClick={handleSeeFolder}
              disabled={seeLoading}
              className="w-full"
            >
              Choose folder
            </Button>
          </div>
          {seeError && (
            <p className="text-destructive text-sm">{seeError}</p>
          )}
        </div>
      </div>
    </div>
  )
}
