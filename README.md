# mupattern

End-to-end pipeline for analyzing T-cell killing of cancer cells on micropatterns.

MCF7 cancer cells adhere to micropatterns printed on glass. CAR-T cells are added and kill cancer cells over time, causing them to detach. The pipeline classifies "cell present / absent" per micropattern crop per timepoint, then plots kill curves showing how many cells survive over time.

### Positions

| Position | Condition | Description |
|----------|-----------|-------------|
| Pos140 | Control | MCF7 only, no T-cells |
| Pos150 | Killing 2D | MCF7 + CAR-T cells in suspension |
| Pos156 | Killing 3D | MCF7 + CAR-T cells in collagen gel |

## Pipeline overview

```
ND2 ──► mufile convert ──► raw TIFFs ──► mupattern ──► bbox CSV ──► mufile crop ──► crops.zarr
                                                        │
                                                        ▼
                                                      musee ──► annotation CSV
                                                        │
                                                        ▼
                                                mukill dataset ──► HF Dataset
                                                        │
                                                        ▼
                                                  mukill train ──► model weights
                                                        │
                                                        ▼
                                                mukill predict ──► predictions CSV
                                                        │
                                                        ▼
                                                  mukill clean ──► cleaned CSV
                                                        │
                                                        ▼
                                                   mukill plot ──► kill curve plots

                                              muexpression analyze ──► expression CSV
                                                        │
                                                        ▼
                                                muexpression plot ──► expression plots

                                                  muspot detect ──► spots CSV
                                                        │
                                                        ▼
                                                    muspot plot ──► spot count plots
```

## Packages

| Package | Language | Description |
|---------|----------|-------------|
| `mupattern/` | React/Vite | Fit a Bravais lattice grid to microscopy images, export bounding-box CSV |
| `mufile/` | Python CLI | Microscopy file utilities: convert ND2 → TIFF, crop TIFFs → zarr |
| `musee/` | React/Vite | Browse crops in the zarr store, annotate cell presence/absence |
| `mukill/` | Python CLI | Build HuggingFace Dataset, train ResNet-18 classifier, run inference, enforce monotonicity, plot kill curves |
| `muexpression/` | Python CLI | Measure fluorescence expression per crop over time, plot intensity curves |
| `muspot/` | Python CLI | Detect fluorescent spots per crop over time using spotiflow, plot spot count curves |
| `shared/` | React | Shared shadcn/ui components used by mupattern and musee |

## Prerequisites

- [Bun](https://bun.sh/) for JavaScript/TypeScript packages
- [uv](https://docs.astral.sh/uv/) for Python packages
- Raw microscopy data: either an ND2 file (use `mufile convert` first) or 2048x2048 uint16 TIFFs named `img_channel{C}_position{N}_time{T}_z{Z}.tif` in `Pos{N}/` directories

## Step-by-step guide

### 1. Fit the pattern grid (mupattern)

Open the web app and load a phase contrast image from your microscopy data (any single timepoint, e.g. `t=0`).

```bash
cd mupattern
bun install
bun run dev
# open http://localhost:5173
```

In the app:

1. **Load image**: drag-and-drop a TIF/PNG from your position folder
2. **Set calibration**: pick the objective preset (10x, 20x, 40x) or type µm/pixel
3. **Configure lattice**: set parameters `a`, `b`, `α`, `β`, and square size to match the micropattern geometry. Use "Square" or "Hex" presets if applicable
4. **Auto-detect** (optional): click "Detect cells" to find grid points (shown as green crosses), then click "Auto square (a=b)" or "Auto hex (a=b)" to fit the lattice. Works best on clear phase contrast images with regular spacing
5. **Align**: drag the pattern overlay to fine-tune — left-drag to pan, middle-drag to scale, right-drag to rotate
6. **Export**: click Export to download three files:
   - `*_bbox.csv` — bounding boxes for each pattern site (`crop,x,y,w,h`)
   - `*_config.yaml` — lattice parameters (for reloading later)
   - `*_mask.png` — binary mask image

The bbox CSV is the input for the next step. Repeat for each position if the pattern grid differs.

### 2a. Convert ND2 to TIFF (mufile convert)

If your raw data is in Nikon ND2 format, convert it to per-position TIFF folders first:

```bash
uv run mufile convert /path/to/data.nd2 --pos all --time all --output /path/to/data
```

`--pos` and `--time` are required and accept `"all"` or a comma-separated mix of indices and Python-style slices:

```bash
# Convert only positions 0-2 and timepoints 0-49
uv run mufile convert /path/to/data.nd2 --pos "0:3" --time "0:50"

# Cherry-pick positions and timepoints
uv run mufile convert /path/to/data.nd2 --pos "0, 3, 5" --time "0:10, 50, -5:"

# Negative indices and steps work too
uv run mufile convert /path/to/data.nd2 --pos "-1" --time "0:100:2"
```

Before writing, the command prints the full list of selected positions and timepoints and asks for confirmation. TIFF filenames use contiguous 0-based time indices (so `crop` works unchanged); each `Pos{N}/` folder gets a `time_map.csv` mapping the TIFF time index back to the original ND2 timepoint.

### 2b. Crop into zarr (mufile crop)

Cut each pattern site out of every frame and store as a zarr array.

```bash
uv run mufile crop \
  --input /path/to/data \
  --pos 150 \
  --bbox /path/to/bbox.csv \
  --output /path/to/crops.zarr \
  --no-background
```

- `--input` is the **parent** directory containing `Pos{N}/` subdirectories
- `--pos` is the position number (e.g. `150` reads from `Pos150/`)
- `--bbox` is the CSV exported by mupattern
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

### 3. Annotate in musee

Open the crop viewer to label cells as present or absent.

```bash
cd musee
bun install
bun run dev
# open http://localhost:5174
```

In the app:

1. **Open folder**: click "Open zarr" and select the `pos/150/crop/` directory inside your `crops.zarr` store using the browser's folder picker
2. **Browse**: use the time slider and transport controls (`|<`, `<<`, `<`, play, `>`, `>>`, `>|`) to scrub through timepoints. The 5x5 grid shows crops with auto-contrast
3. **Annotate**: click the "Annotate" toggle, then click crops to cycle through states:
   - **No ring** → **Blue ring** (present) → **Red ring** (absent) → **No ring**
   - **Green ring** appears on crops annotated at other timepoints but not the current one (helps you find gaps)
4. **Navigate pages**: use page controls below the grid to see all crops
5. **Save**: click "Save CSV" to download `annotations.csv` with format `t,crop,label`

Tips:
- Start at `t=0` and annotate a representative subset of crops (e.g. 20–30 crops)
- For each crop, annotate several timepoints covering the transition from present to absent
- You need at least ~400 labeled samples for decent training. In our case, 28 crops × 15 timepoints = 420 labels

### 4. Build training dataset (mukill dataset)

Convert the zarr crops + annotation CSV into a HuggingFace Dataset.

Create a config YAML:

```yaml
# dataset.yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 150
    annotations: /path/to/annotations.csv
```

Run:

```bash
uv run mukill dataset \
  --config /path/to/dataset.yaml \
  --output /path/to/dataset
```

This reads every annotated `(t, crop)` pair from the zarr store, normalizes uint16 → uint8, and saves as a HuggingFace Dataset with columns: `image`, `label` (0=absent, 1=present), `pos`, `crop`, `t`.

### 5. Train the classifier (mukill train)

Fine-tune a pretrained ResNet-18 on your dataset.

```bash
uv run mukill train \
  --dataset /path/to/dataset \
  --output /path/to/model \
  --epochs 20 \
  --batch-size 32 \
  --lr 1e-4
```

The best checkpoint (by F1 score) is saved to `model/best/`. Training takes ~45 seconds on Apple Silicon with 420 samples. Our model achieved 96.5% accuracy and 0.97 F1.

Our pretrained model is available on HuggingFace: [keejkrej/mupattern-resnet18](https://huggingface.co/keejkrej/mupattern-resnet18)

Options:
- `--epochs` — number of training epochs (default: 20)
- `--batch-size` — training batch size (default: 32)
- `--lr` — learning rate (default: 1e-4)
- `--split` — validation fraction (default: 0.2)

### 6. Predict on all crops (mukill predict)

Run inference on the full zarr store (or a subset).

Create a predict config YAML:

```yaml
# predict.yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 150
    t_range: [0, 50]       # optional: only predict t=0..49
    crop_range: [0, 125]   # optional: only predict crops 0..124
```

Run:

```bash
# Using the pretrained model from HuggingFace:
uv run mukill predict \
  --config /path/to/predict.yaml \
  --model keejkrej/mupattern-resnet18 \
  --output /path/to/predictions.csv

# Or using a local model directory:
uv run mukill predict \
  --config /path/to/predict.yaml \
  --model /path/to/model/best \
  --output /path/to/predictions.csv
```

Output is a CSV in the same `t,crop,label` format as annotations — can be loaded back into musee for visual verification.

### 7. Clean and plot (mukill)

The raw predictions may have "flickering" — a cell classified as absent then present again. Since dead cells can't come back, enforce monotonicity:

```bash
# Clean: once absent, stays absent
uv run mukill clean \
  --input /path/to/predictions.csv \
  --output /path/to/cleaned.csv

# Plot: kill curve + death time histogram
uv run mukill plot \
  --input /path/to/cleaned.csv \
  --output /path/to/kill_curve.png
```

The `clean` command reports which crops had violations (resurrections) and forces all timepoints after the first absence to absent.

The `plot` command generates two panels:
- **Kill curve**: number of present cells over time
- **Death time histogram**: when cells died (first timepoint classified absent)

Death times at `t=0` are excluded — a crop absent at `t=0` means no cell was ever present on that pattern site, not a death event.

### 8. Detect spots (muspot)

Detect fluorescent spots per crop per timepoint using spotiflow.

Create a config YAML:

```yaml
# spots.yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 0
    channel: 1
```

Run:

```bash
# Detect spots
uv run muspot detect \
  --config /path/to/spots.yaml \
  --output /path/to/spots.csv

# Use a different spotiflow model
uv run muspot detect \
  --config /path/to/spots.yaml \
  --output /path/to/spots.csv \
  --model general

# Plot spot counts over time
uv run muspot plot \
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
  kill_pos140_config.yaml           # mukill predict config for Pos140
  kill_pos150_config.yaml           # mukill predict config for Pos150
  kill_pos156_config.yaml           # mukill predict config for Pos156
  kill_pos140.png                   # kill curve — control
  kill_pos150.png                   # kill curve — killing 2D
  kill_pos156.png                   # kill curve — killing 3D
  spot_pos9_bbox.csv                # Pos9 bounding boxes (spot detection)
  spot_pos9_config.yaml             # muspot detect config for Pos9 (channel 2)
  spot_pos9.png                     # spot count curves — Pos9
  expression_pos0_bbox.csv          # Pos0 bounding boxes (HuH7)
  expression_pos1_bbox.csv          # Pos1 bounding boxes (HuH7)
  expression_pos0_config.yaml       # muexpression analyze config for Pos0
  expression_pos1_config.yaml       # muexpression analyze config for Pos1
  expression_pos0.jpg               # expression curves — Pos0
  expression_pos1.jpg               # expression curves — Pos1
```

Model weights are hosted on HuggingFace: [keejkrej/mupattern-resnet18](https://huggingface.co/keejkrej/mupattern-resnet18)

To download:

```bash
uvx --from huggingface_hub hf download keejkrej/mupattern-resnet18 --local-dir ./model/best
```

## File formats

### Bounding box CSV (mupattern → mufile crop)

```csv
crop,x,y,w,h
0,28,1878,77,77
1,22,1678,77,77
```

### Annotation / prediction CSV (musee ↔ mukill)

```csv
t,crop,label
0,000,true
0,001,false
1,000,true
```

All tools use the same `t,crop,label` format. Labels are `true` (cell present) or `false` (cell absent).

### Dataset config YAML (mukill dataset)

```yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 150
    annotations: /path/to/annotations.csv
```

### Spot CSV (muspot detect → muspot plot)

```csv
t,crop,spot,y,x
0,000,0,12.34,56.78
0,000,1,23.45,67.89
1,000,0,11.22,55.66
```

One row per detected spot. `spot` is a 0-based index within each `(t, crop)` frame. `y` and `x` are subpixel spot coordinates.

### Predict config YAML (mukill predict)

```yaml
sources:
  - zarr: /path/to/crops.zarr
    pos: 150
    t_range: [0, 50]       # [start, end), optional
    crop_range: [0, 125]   # [start, end), optional
```

## Development

```bash
# Install JS dependencies (from repo root)
bun install

# Run mupattern
cd mupattern && bun run dev

# Run musee
cd musee && bun run dev

# Run Python CLIs from repo root (uv workspace)
uv run mufile --help
uv run mukill --help
uv run muexpression --help
uv run muspot --help
```

## Tech stack

- **mupattern / musee**: React 18, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, HTML5 Canvas, File System Access API
- **mufile**: Python, typer, zarr v2, tifffile, numpy, nd2
- **mukill**: Python, typer, transformers (HuggingFace), torch, zarr v2, datasets, evaluate, pandas, matplotlib
- **muexpression**: Python, typer, zarr v2, numpy, pandas, matplotlib
- **muspot**: Python, typer, spotiflow, zarr v2, numpy, pandas, matplotlib
