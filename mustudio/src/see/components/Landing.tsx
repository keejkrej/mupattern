import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { HexBackground } from "@/components/HexBackground"
import { ThemeToggle } from "@/components/ThemeToggle"
import { useTheme } from "@/components/ThemeProvider"
import { FolderOpen } from "lucide-react"

interface LandingProps {
  loading: boolean
  error: string | null
}

export function Landing({ loading, error }: LandingProps) {
  const { theme } = useTheme()
  const navigate = useNavigate()

  return (
    <div className="relative flex flex-col items-center justify-center h-screen gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="text-center">
        <h1
          className="text-4xl tracking-tight"
          style={{ fontFamily: '"Bitcount", monospace' }}
        >
          See
        </h1>
        <p className="text-muted-foreground mt-1 text-center max-w-md">
          Micropattern crop viewer
        </p>
      </div>

      <div className="border rounded-lg p-8 backdrop-blur-sm bg-background/80 max-w-md w-full">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center justify-center gap-4">
            <FolderOpen className="size-12 text-muted-foreground flex-shrink-0" />
            <p className="font-medium">
              {loading ? "Loading..." : error ? "Could not open crops.zarr" : "Open crops.zarr"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading crops.zarr from workspace..."
              : "Select a workspace with crops.zarr to browse micropattern crops."}
          </p>
          {error ? (
            <Button onClick={() => navigate("/workspace")} variant="outline">
              Back to Workspaces
            </Button>
          ) : null}
        </div>
      </div>

      {error && (
        <p className="text-destructive text-sm max-w-md text-center">
          {error}
        </p>
      )}
    </div>
  )
}
