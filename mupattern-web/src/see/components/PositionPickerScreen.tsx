import { HexBackground, ThemeToggle, useTheme } from "@mupattern/shared";
import { PositionPicker } from "@/see/components/PositionPicker";

interface PositionPickerScreenProps {
  positions: string[];
  loading: boolean;
  error: string | null;
  onConfirm: (selected: string[]) => void;
}

export function PositionPickerScreen({
  positions,
  loading,
  error,
  onConfirm,
}: PositionPickerScreenProps) {
  const { theme } = useTheme();

  return (
    <div className="relative flex flex-col items-center justify-center h-screen gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="text-center">
        <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>
          See
        </h1>
      </div>

      <PositionPicker positions={positions} loading={loading} onConfirm={onConfirm} />

      {error && <p className="text-destructive text-sm max-w-md text-center">{error}</p>}
    </div>
  );
}
