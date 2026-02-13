import { ThemeToggle } from "@/components/ThemeToggle"
export function Header() {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>MuRegister</h1>
          <p
            className="text-base text-muted-foreground"
            title="Drag: pan | Middle-drag: resize | Right-drag: rotate"
          >
            Microscopy pattern-to-image registration
          </p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <ThemeToggle />
      </div>
    </header>
  )
}
