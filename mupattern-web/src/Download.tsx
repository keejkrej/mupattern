import { HexBackground, ThemeToggle, useTheme } from "@mupattern/shared";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function DownloadPage() {
  const { theme } = useTheme();

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-6 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <h1
        className="text-4xl font-normal tracking-tight"
        style={{ fontFamily: '"Bitcount", monospace' }}
      >
        Download
      </h1>

      <Link
        to="/"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Back to home
      </Link>
    </div>
  );
}
