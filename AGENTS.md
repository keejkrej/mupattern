# Rules

- Use `bun` for JavaScript/TypeScript projects (not npm/yarn/pnpm)
- Use `uv` for Python projects (not pip/poetry/pipx)
- CLI args should be as mandatory as possible (no defaults) so users understand the full potential of the app

## Project structure

- **Root** `pyproject.toml` defines a uv workspace; Python package: `mupattern-py`
- Run Python CLIs from repo root: `uv run mupattern --help` and domain subcommands like `uv run mupattern crop --help`.
- **mupattern-py** (pure Python CLI, reference): Top-level inference: `convert`, `crop`, `movie`, `expression`, `kill`, `spot`, `tissue`. Python-only: `plot` (expression, kill, spot, tissue), `train kill` (train), `dataset kill`. For ONNX export (for mupattern-desktop), use `uv run optimum-cli export onnx` — see models/README.md. `kill` runs predict then clean (monotonicity) in one pipeline. Prod code lives in mupattern-desktop (Rust binary + ONNX). Uses `nd2` (nd2-py) for ND2; `common.nd2_utils.read_frame_2d(f, p, t, c, z)` for 2D Y×X frames.
- **mupattern-rs** (Rust CLI): `convert` (ND2→TIFF), `crop`, `expression`, `kill`, `movie`, `tissue`. Uses `nd2-rs`, `zarrs`, `ort` (ONNX), `cellpose-rs`, `cellsam-rs`. Build: `cargo build`; run: `cargo run -p mupattern-rs -- kill --input /path/to/crops.zarr --pos 150 --model models/mupattern-resnet18 --output predictions.csv`. Tissue models (sibling workspaces): Cellpose `../cellpose-rs/models/cellpose-cpsam`; CellSAM `../cellsam-rs/models/cellsam`. ND2 access: `sizes()`, `read_frame_2d(p,t,c,z)`.
- **nd2-rs** (external): Pure Rust ND2 reader at github.com/keejkrej/nd2-rs. Dep: `nd2-rs = { git = "..." }` or `nd2-rs = "0.1"`. API: `sizes()` → (P,T,C,Z,Y,X), `read_frame_2d(p,t,c,z)` → Y×X u16.
- **crops.zarr** layout (Zarr v3 only): `pos/{pos:03d}/crop/{crop_id}` arrays (T, C, Z, H, W); optional `pos/{pos:03d}/background` (T, C, Z) per-pixel. Expression CSV: `t,crop,intensity,area,background`. Tissue: `mupattern tissue` runs segment then analyze (writes **masks.zarr** + CSV `t,crop,cell,total_fluorescence,cell_area,background`); `plot tissue` uses `(total_fluorescence/cell_area)-background > gfp_threshold` for GFP+.
- JS app (web): `mupattern-web` — lite web app (landing, register, see), deployed on Firebase; run with `bun run dev` from that directory
- JS app (desktop): `mupattern-desktop` — Electron workspace-first app; Tasks (convert, crop, movie, expression, kill) with Clean completed; run with `bun run dev` from that directory

## Product direction

- `mupattern-web` is frozen/maintenance-only. Avoid feature work unless explicitly requested; only apply critical fixes/docs tweaks.
- New feature development should go to `mupattern-desktop`.

