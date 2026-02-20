import { useNavigate } from "react-router-dom"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { Home } from "lucide-react"

interface AppHeaderProps {
  title: string
  subtitle: string
  backTo?: string
  backLabel?: string
  onBackClick?: () => void
  right?: React.ReactNode
}

export function AppHeader({
  title,
  subtitle,
  backTo,
  backLabel = "Home",
  onBackClick,
  right,
}: AppHeaderProps) {
  const navigate = useNavigate()

  const handleBack = () => {
    onBackClick?.()
    if (backTo) navigate(backTo)
  }

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-6">
        {backTo && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleBack}
            title={`Back to ${backLabel.toLowerCase()}`}
          >
            <Home className="size-4" />
          </Button>
        )}
        <div>
          <h1
            className="text-4xl tracking-tight"
            style={{ fontFamily: '"Bitcount", monospace' }}
          >
            {title}
          </h1>
          <p className="text-base text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        {right}
        <ThemeToggle />
      </div>
    </header>
  )
}
