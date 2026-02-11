import { Button } from "@/components/ui/button"
import { HexBackground } from "@/components/HexBackground"
import { ThemeToggle } from "@/components/ThemeToggle"
import { useTheme } from "@/components/ThemeProvider"
import { FolderOpen, Microscope, Eye } from "lucide-react"
import { Link } from "react-router-dom"

export default function WorkspaceLanding() {
  const { theme } = useTheme()

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="text-center">
        <h1
          className="text-4xl tracking-tight"
          style={{ fontFamily: '"Bitcount", monospace' }}
        >
          MuPattern
        </h1>
        <p className="text-muted-foreground mt-1">
          Microscopy micropattern tools
        </p>
      </div>

      <div className="flex gap-4">
        <Button variant="outline" size="lg" asChild>
          <Link to="/workspace" className="flex items-center justify-center gap-3 p-6 min-w-[140px]">
            <FolderOpen className="size-6 text-muted-foreground" />
            <span className="font-medium">Workspace</span>
          </Link>
        </Button>
        <Button variant="outline" size="lg" asChild>
          <Link to="/register" className="flex items-center justify-center gap-3 p-6 min-w-[140px]">
            <Microscope className="size-6 text-muted-foreground" />
            <span className="font-medium">Register</span>
          </Link>
        </Button>
        <Button variant="outline" size="lg" asChild>
          <Link to="/see" className="flex items-center justify-center gap-3 p-6 min-w-[140px]">
            <Eye className="size-6 text-muted-foreground" />
            <span className="font-medium">See</span>
          </Link>
        </Button>
      </div>
    </div>
  )
}
