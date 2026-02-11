# Rules

- Use `bun` for JavaScript/TypeScript projects (not npm/yarn/pnpm)
- Use `uv` for Python projects (not pip/poetry/pipx)
- CLI args should be as mandatory as possible (no defaults) so users understand the full potential of the app

## Project structure

- **Root** `pyproject.toml` defines a uv workspace; Python packages: `mufile`, `muexpression`, `muspot`, `mukill`
- Run Python CLIs from repo root: `uv run mufile --help`, `uv run mukill --help`, etc.
- JS app: `mupattern` — unified web app (workspace, register, see); run with `bun run dev` from that directory
