import { Button } from "@mupattern/ui/components/ui/button"

interface ExportButtonProps {
  onExport: () => void
  disabled?: boolean
}

export function ExportButton({ onExport, disabled }: ExportButtonProps) {
  return (
    <Button
      onClick={onExport}
      disabled={disabled}
      size="sm"
      className="flex-1 h-7 text-base"
    >
      Export
    </Button>
  )
}
