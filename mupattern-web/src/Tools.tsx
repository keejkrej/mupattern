import { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, HexBackground, ThemeToggle, useTheme } from "@mupattern/shared";
import { Eye, Microscope } from "lucide-react";
import { loadImagePixelsFromFile } from "@/lib/load-image";
import { startWithImage } from "@/register/store";
import { setSeeSession } from "@/lib/see-session";
import { DirectoryStore } from "@/see/lib/directory-store";
import { listPositions } from "@/see/lib/zarr";

const REQUIRED_TIFF_PATTERN = "img_channel{c}_position{p}_time{t}_z{z}.tif";

export default function Landing() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const registerInputRef = useRef<HTMLInputElement>(null);

  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [seeLoading, setSeeLoading] = useState(false);
  const [seeError, setSeeError] = useState<string | null>(null);

  const handleRegisterFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setRegisterLoading(true);
      setRegisterError(null);
      try {
        const { rgba, width, height, filename } = await loadImagePixelsFromFile(file);
        startWithImage(rgba, filename, width, height);
        navigate("/register");
      } catch (err) {
        setRegisterError(err instanceof Error ? err.message : String(err));
      } finally {
        setRegisterLoading(false);
        e.target.value = "";
      }
    },
    [navigate],
  );

  const handleSeeFolder = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== "function") {
      setSeeError("See requires Chrome or Edge. Safari and Firefox are not supported.");
      return;
    }
    setSeeLoading(true);
    setSeeError(null);
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      const store = new DirectoryStore(handle);
      const positions = await listPositions(handle);
      if (positions.length === 0) {
        setSeeError("No positions found. Expected layout: pos/{id}/crop/{id}/");
        setSeeLoading(false);
        return;
      }
      setSeeSession({ store, dirHandle: handle, availablePositions: positions });
      navigate("/see");
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") {
        setSeeError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSeeLoading(false);
    }
  }, [navigate]);

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-6 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-5xl px-3 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="border rounded-lg p-8 backdrop-blur-sm bg-background/80">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex items-center justify-center gap-4">
                <Microscope className="size-12 text-muted-foreground flex-shrink-0" />
                <p className="font-medium">{registerLoading ? "Loading..." : "Register"}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Open one TIFF image, align the grid, and save `*_bbox.csv`.
              </p>
              <input
                ref={registerInputRef}
                type="file"
                accept="image/png,image/tiff,.tif,.tiff"
                onChange={handleRegisterFile}
                className="hidden"
              />
              <Button
                onClick={() => registerInputRef.current?.click()}
                disabled={registerLoading}
                variant="outline"
                className="w-full"
              >
                Choose file
              </Button>
            </div>
            {registerError && <p className="text-destructive text-sm">{registerError}</p>}
          </div>
          <div className="border rounded-lg p-8 backdrop-blur-sm bg-background/80">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex items-center justify-center gap-4">
                <Eye className="size-12 text-muted-foreground flex-shrink-0" />
                <p className="font-medium">{seeLoading ? "Loading..." : "See"}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Open `crops.zarr` to browse extracted micropattern crops.
              </p>
              <Button onClick={handleSeeFolder} disabled={seeLoading} variant="outline" className="w-full">
                Choose folder
              </Button>
            </div>
            {seeError && <p className="text-destructive text-sm">{seeError}</p>}
          </div>
        </div>

        <section className="border rounded-lg p-6 md:p-8 backdrop-blur-sm bg-background/80 space-y-4">
          <div>
            <div>
              <h2 className="text-xl font-medium">First-time workflow</h2>
              <p className="text-sm text-muted-foreground">
                Register one TIFF per position, crop with `mupattern-crop`, then inspect in See.
              </p>
            </div>
          </div>

          <ol className="list-decimal pl-5 space-y-3 text-sm text-muted-foreground">
            <li>
              Prepare <span className="font-mono text-foreground">C:\data</span> with{" "}
              <span className="font-mono text-foreground">{"Pos{id}"}</span> subfolders directly
              inside it, and TIFF names like{" "}
              <span className="font-mono text-foreground">{REQUIRED_TIFF_PATTERN}</span>.
            </li>
            <li>
              Click <span className="text-foreground">Register</span> and open one TIFF from a
              position. In Register, align the grid, then click{" "}
              <span className="text-foreground">Save</span> to export `*_bbox.csv`.
            </li>
            <li>
              Run the crop command from the{" "}
              <Link to="/download" className="text-foreground underline underline-offset-2">
                download page
              </Link>{" "}
              for that position. Repeat for each position using its own `--pos` and bbox CSV.
            </li>
            <li>
              Click <span className="text-foreground">See</span>, choose the `crops.zarr` folder,
              and review the extracted crops.
            </li>
          </ol>
        </section>

        <section className="flex flex-wrap items-center gap-4 px-1">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to home
          </Link>
          <Link
            to="/download"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Go to download
          </Link>
        </section>
      </div>
    </div>
  );
}
