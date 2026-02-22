# mupattern

End-to-end pipeline for analyzing T-cell killing of cancer cells on micropatterns.

MCF7 cancer cells adhere to micropatterns printed on glass. CAR-T cells are added and kill cancer cells over time, causing them to detach. The pipeline classifies "cell present / absent" per micropattern crop per timepoint, then plots kill curves showing how many cells survive over time.

## App status

- `mupattern-web` (web) is a lite, deployed app and is currently maintenance-only.
- `mupattern-desktop` (desktop) is the primary surface for ongoing feature development, especially workspace flows.

### Positions

| Position | Condition | Description |
|----------|-----------|-------------|
| Pos140 | Control | MCF7 only, no T-cells |
| Pos150 | Killing 2D | MCF7 + CAR-T cells in suspension |
| Pos156 | Killing 3D | MCF7 + CAR-T cells in collagen gel |

## Pipeline overview

```
ND2 ──► mupattern convert ──► raw TIFFs ──► /register ──► bbox CSV ──► mupattern crop ──► crops.zarr
                                                        │
                                                        ▼
                                                      /see ──► annotation CSV
                                                        │
                                                        ▼
                                                mupattern dataset kill ──► HF Dataset
                                                        │
                                                        ▼
                                                  mupattern train kill ──► model weights
                                                        │
                                                        ▼
                                                mupattern kill ──► cleaned predictions CSV
                                                        │
                                                        ▼
                                                mupattern plot kill ──► kill curve plots

                                              mupattern expression ──► expression CSV
                                                        │
                                                        ▼
                                                mupattern plot expression ──► expression plots

                                            mupattern tissue ──► masks.zarr + tissue CSV
                                                        │
                                                        ▼
                                                mupattern plot tissue ──► tissue plots

                                                  mupattern spot ──► spots CSV
                                                        │
                                                        ▼
                                                mupattern plot spot ──► spot count plots
```

## Packages

| Package | Language | Description |
|---------|----------|-------------|
| `mupattern-web/` | React/Vite | Web app: simple landing page + pattern registration (Register) + crop viewer (See) |
| `mupattern-desktop/` | Electron + React/Vite | Desktop app: workspace dashboard + workspace-integrated Register/See experience |
| `mupattern-py/` | Python CLI (reference) | Pure CLI reference implementation; prod uses mupattern-desktop with compiled Rust binary + ONNX |

## Prerequisites

- [Bun](https://bun.sh/) for JavaScript/TypeScript packages
- [uv](https://docs.astral.sh/uv/) for Python packages
- Raw microscopy data: either an ND2 file (use `mupattern convert` first) or 2048x2048 uint16 TIFFs named `img_channel{C}_position{N}_time{T}_z{Z}.tif` in `Pos{N}/` directories

## Step-by-step guide

### 1. Start the web app

```bash
cd mupattern-web
bun install
bun run dev
# open http://localhost:5173
```

The landing page (`/`) links to **Register** and **See**.

`mupattern-web` is intentionally kept minimal and stable; use `mupattern-desktop` for workspace-heavy workflows and new capabilities.

### 1a. Single-file mode (web)

If you only have one image, or want to work without a workspace:

1. Click **Register** on the landing page (or go to `/register`)
2. You'll see the register landing with options to **Load image** (single TIF/PNG) or **Start fresh** (blank canvas)
3. Register the pattern and export as usual

### Registration workflow (both modes)

Once an image is loaded in the registration tool:

1. **Set calibration**: pick the objective preset (10x, 20x, 40x) or type µm/pixel
2. **Configure lattice**: set parameters `a`, `b`, `alpha`, `beta`, and square size to match the micropattern geometry. Use "Square" or "Hex" presets if applicable
3. **Auto-detect** (optional): click "Detect cells" to find grid points (shown as green crosses), then click "Auto square (a=b)" or "Auto hex (a=b)" to fit the lattice. Works best on clear phase contrast images with regular spacing
4. **Align**: drag the pattern overlay to fine-tune — left-drag to pan, middle-drag to scale, right-drag to rotate
5. **Export**: click Export to download three files:
   - `*_bbox.csv` — bounding boxes for each pattern site (`crop,x,y,w,h`)
   - `*_config.yaml` — lattice parameters (for reloading later)
   - `*_mask.png` — binary mask image

The bbox CSV is the input for the cropping step.

### 1b. Workspace mode (desktop via mupattern-desktop)

Use `mupattern-desktop` when you want the folder-based multi-position workflow:

```bash
cd mupattern-desktop
bun install
bun run dev
```

From `mupattern-desktop`, use the workspace dashboard to open a folder, jump into Register, and navigate positions with prev/next. Tasks (convert, crop, movie, expression, kill) run from the Tasks page; use **Clean completed** to remove finished tasks from the list.

### 2a. Convert ND2 to TIFF (mupattern convert)

If your raw data is in Nikon ND2 format, convert it to per-position TIFF folders first:

```bash
uv run mupattern convert /path/to/data.nd2 --pos all --time all --output /path/to/data
```

`--pos` and `--time` are required and accept `"all"` or a comma-separated mix of indices and Python-style slices:

```bash
# Convert only positions 0-2 and timepoints 0-49
uv run mupattern convert /path/to/data.nd2 --pos "0:3" --time "0:50"

# Cherry-pick positions and timepoints
uv run mupattern convert /path/to/data.nd2 --pos "0, 3, 5" --time "0:10, 50, -5:"

# Negative indices and steps work too
uv run mupattern convert /path/to/data.nd2 --pos "-1" --time "0:100:2"
```

Before writing, the command prints the full list of selected positions and timepoints and asks for confirmation. TIFF filenames use contiguous 0-based time indices (so `crop` works unchanged); each `Pos{N}/` folder gets a `time_map.csv` mapping the TIFF time index back to the original ND2 timepoint.

### 2b. Crop into zarr (mupattern crop)

Cut each pattern site out of every frame and store as a zarr array.

```bash
uv run mupattern crop \
  --input /path/to/data \
  --pos 150 \
  --bbox /path/to/bbox.csv \
  --output /path/to/crops.zarr \
  --no-background
```

- `--input` is the **parent** directory containing `Pos{N}/` subdirectories
- `--pos` is the position number (e.g. `150` reads from `Pos150/`)
- `--bbox` is the CSV exported by the registration tool (`/register`)
- `--output` is the zarr store path (created if it doesn't exist, appended if it does)
- `--background` / `--no-background` — whether to compute per-frame background (median of pixels outside all crop bounding boxes), stored in the zarr store

Output layout:

```
crops.zarr/
  pos/
    150/
      crop/
        000/    # shape (T, C, Z, H, W) — e.g. (145, 1, 1, 77, 77)
        001/
        ...
```

Each crop is a TCZYX zarr array with chunk size `(1,1,1,H,W)` for fast single-frame reads.

### 3. Annotate in See

Open the crop viewer to label cells as present or absent. See is available at `/see` within the mupattern-web app.

1. From the landing page, click **See** (or navigate to `/see`)
2. **Open folder**: click "Open crops.zarr" and select the `crops.zarr` directory using the browser's folder picker
3. **Browse**: use the time slider and transport controls (`|<`, `<<`, `<`, play, `>`, `>>`, `>|`) to scrub through timepoints. The 5x5 grid shows crops with auto-contrast
4. **Annotate**: click the "Annotate" toggle, then click crops to cycle through states:
   - **No ring** → **Blue ring** (present) → **Red ring** (absent) → **No ring**
   - **Green ring** appears on crops annotated at other timepoints but not the current one (helps you find gaps)
5. **Navigate pages**: use page controls below the grid to see all crops
6. **Save**: click "Save CSV" to download `annotations.csv` with format `t,crop,label`

Tips:
- Start at `t=0` and annotate a representative subset of crops (e.g. 20–30 crops)
- For each crop, annotate several timepoints covering the transition from present to absent
- You need at least ~400 labeled samples for decent training. In our case, 28 crops × 15 timepoints = 420 labels

### 4. Build training dataset (mupattern dataset kill)

Convert the zarr crops + annotation CSV into a HuggingFace Dataset.

```bash
uv run mupattern dataset kill \
  --input /path/to/crops.zarr \
  --pos 150 \
  --annotations /path/to/annotations.csv \
  --output /path/to/dataset
```

This reads every annotated `(t, crop)` pair from the zarr store, normalizes uint16 → uint8, and saves as a HuggingFace Dataset with columns: `image`, `label` (0=absent, 1=present), `pos`, `crop`, `t`.

### 5. Train the classifier (mupattern train kill)

Fine-tune a pretrained ResNet-18 on your dataset.

```bash
uv run mupattern train kill \
  --dataset /path/to/dataset \
  --output /path/to/model \
  --epochs 20 \
  --batch-size 32 \
  --lr 1e-4 \
  --split 0.2
```

The best checkpoint (by F1 score) is saved to `model/best/`. Training takes ~45 seconds on Apple Silicon with 420 samples. Our model achieved 96.5% accuracy and 0.97 F1.

Our pretrained model is available on HuggingFace: [keejkrej/mupattern-resnet18](https://huggingface.co/keejkrej/mupattern-resnet18)

To run kill inference in **mupattern-desktop** (without Python), download or export the model first: see [models/README.md](models/README.md) — download with `uv run huggingface-cli download keejkrej/mupattern-resnet18 --local-dir models/mupattern-resnet18` or export with `uv run optimum-cli export onnx --model keejkrej/mupattern-resnet18 models/mupattern-resnet18`.

Options:
- `--epochs` — number of training epochs (default: 20)
- `--batch-size` — training batch size (default: 32)
- `--lr` — learning rate (default: 1e-4)
- `--split` — validation fraction (default: 0.2)

### 6. Predict on all crops (mupattern kill)

Run inference on the full zarr store (or a subset).

```bash
# Using the pretrained model from HuggingFace:
uv run mupattern kill \
  --input /path/to/crops.zarr \
  --pos 150 \
  --model keejkrej/mupattern-resnet18 \
  --output /path/to/predictions.csv \
  --batch-size 32

# With optional time/crop range:
uv run mupattern kill \
  --input /path/to/crops.zarr \
  --pos 150 \
  --model /path/to/model/best \
  --output /path/to/predictions.csv \
  --batch-size 32 \
  --t-start 0 --t-end 50 \
  --crop-start 0 --crop-end 125
```

Output is a CSV in the same `t,crop,label` format as annotations — can be loaded back into See for visual verification.

### 7. Plot (mupattern plot kill)

`mupattern kill` runs inference then cleans predictions (enforces monotonicity: once absent, stays absent). The output is ready for plotting:

```bash
uv run mupattern plot kill \
  --input /path/to/predictions.csv \
  --output /path/to/kill_curve.png
```

The plot generates two panels:
- **Kill curve**: number of present cells over time
- **Death time histogram**: when cells died (first timepoint classified absent)

Death times at `t=0` are excluded — a crop absent at `t=0` means no cell was ever present on that pattern site, not a death event.

### 8. Tissue — multi-cell crops (mupattern tissue)

For crops with multiple cells per pattern (e.g. ~10 cells, phase + fluorescence), run segment then analyze in one command:

```bash
# Segment + analyze: Cellpose on each crop/frame, then measure per-cell fluorescence
uv run mupattern tissue \
  --input /path/to/crops.zarr \
  --pos 0 \
  --channel-phase 0 \
  --channel-fluorescence 1 \
  --output /path/to/tissue.csv \
  --method cellpose

# Plot: GFP+ count and mean/median intensity above background over time
uv run mupattern plot tissue \
  --input /path/to/tissue.csv \
  --output /path/to/tissue_plots \
  --gfp-threshold 1.0
```

- **tissue** runs segment (Cellpose/CellSAM/watershed) then analyze: writes `masks.zarr` (default: same dir as output) and CSV `t,crop,cell,total_fluorescence,cell_area,background`. Use `--method watershed` for fluo-only (no phase channel).
- **plot tissue** treats a cell as GFP+ when `(total_fluorescence / cell_area) - background > --gfp-threshold`, then plots GFP+ count and mean/median of that value over time.

### 9. Detect spots (mupattern spot)

Detect fluorescent spots per crop per timepoint using spotiflow.

```bash
# Detect spots
uv run mupattern spot \
  --input /path/to/crops.zarr \
  --pos 0 \
  --channel 1 \
  --output /path/to/spots.csv \
  --crop all \
  --model general

# Plot spot counts over time
uv run mupattern plot spot \
  --input /path/to/spots.csv \
  --output /path/to/spots.png
```

## Results

### Pos150 — Killing 2D (MCF7 + CAR-T in suspension)

![Kill curve Pos150 (cleaned)](examples/kill_pos150.png)

- 125 crops analyzed over 50 timepoints
- 72 empty at `t=0` (no cell present)
- 32 cells killed by T-cells
- 0 survived (within the 50-timepoint window)
- 70/125 crops had monotonicity violations (187 resurrection events) before cleaning

### Pos156 — Killing 3D (MCF7 + CAR-T in collagen gel)

![Kill curve Pos156 (cleaned)](examples/kill_pos156.png)

- 125 crops analyzed over 50 timepoints
- 72 empty at `t=0`
- 32 cells killed
- 21 survived
- 48/125 crops had monotonicity violations (1138 resurrection events) before cleaning — much noisier than 2D, likely due to collagen gel obscuring cells

### Pos140 — Control (MCF7 only, no T-cells)

![Kill curve Pos140 (cleaned)](examples/kill_pos140.png)

- 125 crops analyzed over 50 timepoints
- 72 empty at `t=0`
- 6 false deaths (model errors — no T-cells were added)
- 47 survived all 50 timepoints
- False positive death rate: ~11% (6/53 cells that were actually present)

### Spot detection — Pos9

![Spot counts Pos9](examples/spot_pos9.png)

- 36 crops (6×6 grid, 154×154 px), 163 timepoints, channel 2 (fluorescence)
- 24,547 spots detected across all 36 crops
- Several crops show a transient burst peaking at t≈30 (60–80 spots), decaying by t≈60
- Lower-expressing crops remain flat at 5–15 spots throughout

### Expression — HuH7 Pos0

![Expression Pos0](examples/expression_pos0.jpg)

- 145 crops, 180 timepoints, channel 1 (fluorescence)
- Left: raw summed intensity per crop; Right: background-subtracted

### Expression — HuH7 Pos1

![Expression Pos1](examples/expression_pos1.jpg)

- 169 crops, 180 timepoints, channel 1 (fluorescence)
- Left: raw summed intensity per crop; Right: background-subtracted

## Data files

```
examples/
  kill_pos140_bbox.csv              # Pos140 bounding boxes (control — MCF7 only)
  kill_pos150_bbox.csv              # Pos150 bounding boxes (killing 2D — MCF7 + CAR-T in suspension)
  kill_pos156_bbox.csv              # Pos156 bounding boxes (killing 3D — MCF7 + CAR-T in collagen gel)
  kill_pos150_annotation.csv        # manual annotations (420 labels, 28 crops, t=0..21)
  kill_pos140_config.yaml           # mupattern kill config for Pos140
  kill_pos150_config.yaml           # mupattern kill config for Pos150
  kill_pos156_config.yaml           # mupattern kill config for Pos156
  kill_pos140.png                   # kill curve — control
  kill_pos150.png                   # kill curve — killing 2D
  kill_pos156.png                   # kill curve — killing 3D
  spot_pos9_bbox.csv                # Pos9 bounding boxes (spot detection)
  spot_pos9_config.yaml             # mupattern spot config for Pos9 (channel 2)
  spot_pos9.png                     # spot count curves — Pos9
  expression_pos0_bbox.csv          # Pos0 bounding boxes (HuH7)
  expression_pos1_bbox.csv          # Pos1 bounding boxes (HuH7)
  expression_pos0_config.yaml       # mupattern expression config for Pos0
  expression_pos1_config.yaml       # mupattern expression config for Pos1
  expression_pos0.jpg               # expression curves — Pos0
  expression_pos1.jpg               # expression curves — Pos1
```

Model weights are hosted on HuggingFace: [keejkrej/mupattern-resnet18](https://huggingface.co/keejkrej/mupattern-resnet18)

To download:

```bash
uvx --from huggingface_hub hf download keejkrej/mupattern-resnet18 --local-dir ./model/best
```

## File formats

### Bounding box CSV (Register → mupattern crop)

```csv
crop,x,y,w,h
0,28,1878,77,77
1,22,1678,77,77
```

### Annotation / prediction CSV (See ↔ mupattern kill)

```csv
t,crop,label
0,000,true
0,001,false
1,000,true
```

All tools use the same `t,crop,label` format. Labels are `true` (cell present) or `false` (cell absent).

### Dataset (mupattern dataset kill)

```yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 150
    annotations: /path/to/annotations.csv
```

### Expression CSV (mupattern expression → mupattern plot expression)

```csv
t,crop,intensity,area,background
0,000,12345,5929,2.1
0,001,9876,5929,2.1
1,000,12400,5929,2.0
```

One row per crop per timepoint. `intensity` is the sum of pixel values in the crop; `area` is the number of pixels (h×w); `background` is the per-pixel background for that frame/channel (from `crops.zarr`). Background-subtracted intensity = `intensity - background * area`.

### Tissue CSV (mupattern tissue → mupattern plot tissue)

```csv
t,crop,cell,total_fluorescence,cell_area,background
0,000,1,1234.5,892,2.1
0,000,2,987.2,756,2.1
0,001,1,456.7,623,2.1
1,000,1,1450.2,895,2.0
```

One row per cell per frame. `cell` is the segmentation label (1, 2, …); `total_fluorescence` is the sum of fluorescence in that cell’s pixels; `cell_area` is the number of pixels in the cell; `background` is per-pixel background for that frame/channel (0 if missing from crops.zarr). GFP+ in plot: `(total_fluorescence / cell_area) - background > --gfp-threshold`.

### Spot CSV (mupattern spot → mupattern plot spot)

```csv
t,crop,spot,y,x
0,000,0,12.34,56.78
0,000,1,23.45,67.89
1,000,0,11.22,55.66
```

One row per detected spot. `spot` is a 0-based index within each `(t, crop)` frame. `y` and `x` are subpixel spot coordinates.

### Predict (mupattern kill)

```yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 150
    t_range: [0, 50]       # [start, end), optional
    crop_range: [0, 125]   # [start, end), optional
```

## Development

```bash
# Install JS dependencies and run the web app
cd mupattern-web
bun install
bun run dev

# Desktop workspace app
cd ../mupattern-desktop
bun install
bun run dev

# Run Python CLIs from repo root (uv workspace)
uv run mupattern --help
uv run mupattern crop --help
uv run mupattern kill --help
uv run mupattern expression --help
uv run mupattern tissue --help
uv run mupattern spot --help
```

## Tech stack

- **mupattern-web** (web register + see): React 18, TypeScript, Vite, React Router, TanStack Store, Tailwind CSS 4, shadcn/ui, HTML5 Canvas, File System Access API
- **mupattern-desktop** (desktop workspace): Electron, React 18, TypeScript, Vite, React Router, TanStack Store
- **mupattern-py** (CLI reference): Python, typer, zarr v2, tifffile, nd2, transformers, torch, cellpose, spotiflow, pandas, matplotlib

