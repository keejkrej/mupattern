import { Button, HexBackground, ThemeToggle, useTheme } from "@mupattern/shared";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";

const MUPATTERN_CROP_WINDOWS_URL =
  "https://github.com/SoftmatterLMU-RaedlerGroup/mupattern/releases/latest/download/mupattern-crop-windows-x86_64.exe";
const REQUIRED_TIFF_PATTERN = "img_channel{c}_position{p}_time{t}_z{z}.tif";

export default function DownloadPage() {
  const { theme } = useTheme();

  return (
    <div className="relative flex min-h-[100dvh] flex-col p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="relative z-10 mx-auto my-auto w-full max-w-4xl space-y-6">
        <section className="border rounded-lg p-5 md:p-6 bg-background/80 backdrop-blur-sm space-y-5">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Download mupattern-crop
            </p>
            <p className="text-sm text-muted-foreground max-w-3xl">
              `mupattern-crop` is a Windows command-line tool that takes one position folder and
              one Register bbox CSV and writes crop arrays into `crops.zarr`.
            </p>
            <a href={MUPATTERN_CROP_WINDOWS_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">
                <Download className="size-4" />
                Download mupattern-crop.exe
              </Button>
            </a>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Input requirements
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
              <li>
                Input folder (for example{" "}
                <span className="font-mono text-foreground">C:\data</span>) must contain position
                folders named <span className="font-mono text-foreground">{"Pos{id}"}</span>{" "}
                (example: `Pos150`, `Pos151`) directly at the top level.
              </li>
              <li>
                TIFF files inside each position folder must match{" "}
                <span className="font-mono text-foreground">{REQUIRED_TIFF_PATTERN}</span>.
              </li>
              <li>
                BBox CSV must come from Register `Save` output and include columns: `crop,x,y,w,h`.
              </li>
            </ul>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Usage</p>
            <p className="text-sm text-muted-foreground">
              Run one command per position, using that position&apos;s bbox CSV.
            </p>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-foreground">
              <code>
                {`mupattern-crop.exe --input C:\\data --pos 150 --bbox C:\\data\\Pos150_bbox.csv --output C:\\data\\crops.zarr`}
              </code>
            </pre>
            <p className="text-sm text-muted-foreground">
              Repeat the command for each position (`--pos`) and bbox file. Output uses Zarr v3
              layout: <span className="font-mono text-foreground">{"pos/{pos}/crop/{crop}"}</span>.
            </p>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-4">
          <Link
            to="/tools"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to tools
          </Link>
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to home
          </Link>
        </section>
      </div>
    </div>
  );
}
