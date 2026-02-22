# mupattern

End-to-end pipeline for high-throughput single-cell analysis on micropatterns.

Designed to analyze dynamic cell behaviors on micropattern arrays, including:
- **Killing Assays**: Tracking cancer cell survival and detachment in the presence of T-cells.
- **Fluorescence Dynamics**: Quantifying protein expression and localization over time.
- **Subcellular Feature Detection**: Identifying and counting spots or organelles within single cells.

The pipeline handles everything from raw microscopy data conversion and grid registration to deep learning-based classification and quantitative analysis.

## Overview

- **mupattern-desktop** (Electron/React): The primary workspace for processing multi-position datasets.
- **mupattern-web** (React): A lightweight web version for single-image pattern registration (`/register`) and crop viewing (`/see`).
- **mupattern-rs** (Rust): High-performance CLI for production processing (crop, expression, movie), used by the desktop app.
- **mupattern-crop** (Rust): Standalone Windows crop-only binary for web-tool users.
- **mupattern-py** (Python): Reference CLI implementation and training/inference tools.

## Prerequisites

- [Bun](https://bun.sh/) (for web/desktop apps)
- [uv](https://docs.astral.sh/uv/) (for Python CLI)
- Raw microscopy data: Nikon ND2 files or TIFF series.

## Quick Start

### 1. Run the Desktop App (Recommended)

The desktop app provides a full workspace for managing the entire pipeline.

```bash
cd mupattern-desktop
bun install
bun run dev
```

### 2. Run the Web App (Lite)

Useful for quick pattern registration or viewing crops without a workspace.

```bash
cd mupattern-web
bun install
bun run dev
# Open http://localhost:5173
```

### 3. CLI Usage

All processing steps can be run directly via the CLI.

```bash
# List all commands
uv run mupattern --help

# Common workflows
uv run mupattern convert --help   # Convert ND2 to TIFF
uv run mupattern crop --help      # Crop pattern sites to zarr
uv run mupattern kill --help      # Predict cell survival
```

### 4. Web Tools Quick Workflow (Register -> Crop -> See)

Use this when you want to stay in `mupattern-web` and run only cropping from CLI:

1. Prepare `C:\data` with `Pos{id}` subfolders directly inside it, e.g. `Pos150`, `Pos151`.
2. TIFF files in each `Pos{id}` must match:
   `img_channel{c}_position{p}_time{t}_z{z}.tif`
3. In web `/tools`, open one TIFF in **Register**, align grid, click **Save** to export `*_bbox.csv`.
4. Run crop for each position:

```powershell
mupattern-crop.exe --input C:\data --pos 150 --bbox C:\data\Pos150_bbox.csv --output C:\data\crops.zarr
```

5. In web `/tools`, open **See** and choose `crops.zarr`.

## Publishing `mupattern-crop` Windows Binary (Manual)

Download page expects this stable latest-release asset URL pattern:

`https://github.com/SoftmatterLMU-RaedlerGroup/mupattern/releases/latest/download/mupattern-crop-windows-x86_64.exe`

To publish a new version:

1. Build the binary from repo root:

```bash
cargo build -p mupattern-crop --release
```

2. Rename/copy output to exactly:

`mupattern-crop-windows-x86_64.exe`

3. Upload that exact filename to a new GitHub release in `SoftmatterLMU-RaedlerGroup/mupattern`.

As long as the filename is unchanged, web `/download` keeps working without code changes.

## Pipeline Stages

1.  **Convert**: Transform raw ND2 files into structured TIFF folders.
2.  **Register**: Align a grid to the micropatterns to define crop regions (via Web or Desktop).
3.  **Crop**: Extract individual pattern sites into a Zarr array.
4.  **Annotate**: Label cells as "present" or "absent" over time to create ground truth.
5.  **Train**: Fine-tune a ResNet-18 model on your annotations.
6.  **Predict (Kill)**: Run the model to generate survival curves.
7.  **Analyze**: Additional modules for `tissue` (fluorescence) and `spot` (spot detection).

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, TanStack Store.
- **Desktop**: Electron.
- **Backend/CLI**: Rust (production), Python (reference & ML training), ONNX Runtime.
