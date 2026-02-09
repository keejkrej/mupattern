import { ThemeToggle } from "@/components/ThemeToggle"
import { useTheme } from "@/components/ThemeProvider"
import { HexBackground } from "@mupattern/ui/components/HexBackground"
import { ArrowUpRight } from "lucide-react"

const apps = [
  {
    name: "MuRegister",
    description: "Pattern-to-image registration for microscopy data",
    href: "https://muregister-8415f.web.app",
  },
  {
    name: "MuSee",
    description: "Browse and explore microscopy image collections",
    href: "https://musee-9d34d.web.app",
  },
]

function App() {
  const { theme } = useTheme()

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-8">
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

      <div className="flex gap-6 max-w-2xl w-full px-6">
        {apps.map((app) => (
          <a
            key={app.name}
            href={app.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 border rounded-lg p-8 hover:border-foreground/30 transition-colors group backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2">
                <p className="font-medium text-lg">{app.name}</p>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {app.description}
              </p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

export default App
