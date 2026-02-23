# mupattern

End-to-end pipeline for high-throughput single-cell analysis on micropatterns: killing assays, fluorescence dynamics, and subcellular feature detection.

**Web app:** [mupattern-e4fec.web.app](https://mupattern-e4fec.web.app)

## Overview

- **mupattern-desktop** (Electron/React): Full workspace for multi-position datasets. Uses mupattern-rs for crop, kill, movie, expression, tissue, spot.
- **mupattern-web** (React): Lightweight web app for pattern registration (`/tools` → Register) and crop viewing (`/tools` → See).
- **mupattern-rs** (Rust): Production CLI (convert, crop, expression, kill, movie, spot, tissue), used by the desktop app.
- **mupattern-py** (Python): Reference CLI + ML training/inference (convert, crop, kill, train, etc.).

## Prerequisites

- [Bun](https://bun.sh/) — web and desktop apps
- [Rust](https://www.rust-lang.org/) — mupattern-rs and for building the desktop app
- [uv](https://docs.astral.sh/uv/) — Python CLI (mupattern-py, requires Python 3.12+)

Optional: [FFmpeg](https://ffmpeg.org/) (for movie export), Nikon ND2 or TIFF input data

## Quick Start

1. Build mupattern-rs (provides the `mupattern` binary the app spawns):

```bash
cargo build -p mupattern-rs --release
```

2. Build the desktop app:

```bash
cd mupattern-desktop
bun install
bun run build
```

3. Package into an installer (electron-builder):

```bash
cd mupattern-desktop
bunx electron-builder
```

Output goes to `mupattern-desktop/release/`. The `mupattern` binary is bundled from `target/release/` into `resources/bin/`.

## Python CLI

The `mupattern-py` package is a reference implementation for convert, crop, movie, expression, kill, spot, tissue, plot, train, and dataset. Run from repo root:

```bash
uv run mupattern --help
```

Production workloads use mupattern-desktop with the Rust backend and ONNX.

## Rust CLI

- **mupattern-rs** — production CLI: convert, crop, expression, kill, movie, spot, tissue. Used by the desktop app.

```bash
cargo run -p mupattern-rs --release -- --help
```

## Pipeline

1. **Convert**: ND2 → TIFF folders
2. **Register**: Align grid, define crop regions (Web or Desktop)
3. **Crop**: Extract pattern sites into Zarr
4. **Analyze** (parallel paths):
   - **Kill**: Annotate (label cells in See) → Train (ResNet-18) → Survival predictions
   - **Expression, Tissue, Spot**: Fluorescence and spot analysis

## Tech Stack

React, TypeScript, Vite, Tailwind CSS, TanStack Store, Electron, Rust, Python, ONNX Runtime.
