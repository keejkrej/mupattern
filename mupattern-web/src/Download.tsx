import { Button, HexBackground, ThemeToggle, useTheme } from "@mupattern/shared";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";

const MUPATTERN_DESKTOP_URL =
  "https://github.com/SoftmatterLMU-RaedlerGroup/mupattern/releases/latest/download/mupattern-desktop-windows-x86_64.exe";
const MUPATTERN_CLI_URL =
  "https://github.com/SoftmatterLMU-RaedlerGroup/mupattern/releases/latest/download/mupattern-windows-x86_64.exe";
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
              Desktop app (Electron)
            </p>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Full workspace for multi-position datasets: convert, register, crop, expression, kill,
              movie, tissue, spot. Windows installer is built via GitHub Actions on release.
            </p>
            <a href={MUPATTERN_DESKTOP_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">
                <Download className="size-4" />
                Download mupattern-desktop-windows-x86_64.exe
              </Button>
            </a>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              CLI (mupattern)
            </p>
            <p className="text-sm text-muted-foreground max-w-3xl">
              `mupattern` CLI (convert, crop, expression, kill, movie, spot, tissue). For the web workflow, use the `crop` subcommand.
            </p>
            <a href={MUPATTERN_CLI_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">
                <Download className="size-4" />
                Download mupattern-windows-x86_64.exe
              </Button>
            </a>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Convert (ND2 → TIFF)
            </p>
            <p className="text-sm text-muted-foreground max-w-3xl">
              If you have Nikon ND2 files, convert them to TIFF folders first:
            </p>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-foreground">
              <code>
                {`mupattern convert --input scan.nd2 --pos all --time all --output C:\\data --yes`}
              </code>
            </pre>
            <p className="text-sm text-muted-foreground">
              Use <span className="font-mono text-foreground">--pos</span> and{" "}
              <span className="font-mono text-foreground">--time</span> to select positions/timepoints (e.g.{" "}
              <span className="font-mono text-foreground">"0:5,10"</span>). Then continue with Register → Crop → See.
            </p>
          </div>

          <div className="h-px bg-border" />

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Crop ({"Pos{id}"} → crops.zarr)
            </p>
            <p className="text-sm text-muted-foreground">
              Input folder (e.g. <span className="font-mono text-foreground">C:\data</span>) must contain{" "}
              <span className="font-mono text-foreground">{"Pos{id}"}</span> folders with TIFFs matching{" "}
              <span className="font-mono text-foreground">{REQUIRED_TIFF_PATTERN}</span>, and a Register bbox CSV with columns{" "}
              <span className="font-mono text-foreground">crop,x,y,w,h</span>. Run one command per position:
            </p>
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-foreground">
              <code>
                {`mupattern crop --input C:\\data --pos 150 --bbox C:\\data\\Pos150_bbox.csv --output C:\\data\\crops.zarr`}
              </code>
            </pre>
            <p className="text-sm text-muted-foreground">
              Repeat for each position. Output layout:{" "}
              <span className="font-mono text-foreground">{"pos/{pos}/crop/{crop}"}</span>.
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
