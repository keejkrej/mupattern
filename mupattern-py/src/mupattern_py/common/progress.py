from __future__ import annotations

import json
import sys
from collections.abc import Callable

ProgressCallback = Callable[[float, str], None]


def progress_json_stderr(progress: float, message: str) -> None:
    """Emit progress as JSON line to stderr, matching mupattern-rs output pattern."""
    print(json.dumps({"progress": progress, "message": message}), file=sys.stderr, flush=True)
