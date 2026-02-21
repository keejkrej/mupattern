from __future__ import annotations


def parse_slice_string(s: str, length: int) -> list[int]:
    """Parse slice expressions like 'all', '1,3', '0:10:2'."""
    if s.strip().lower() == "all":
        return list(range(length))

    indices: set[int] = set()
    for segment in s.split(","):
        segment = segment.strip()
        if not segment:
            continue
        try:
            if ":" in segment:
                parts = [(int(p) if p else None) for p in segment.split(":")]
                if len(parts) == 3 and parts[2] == 0:
                    raise ValueError(f"Slice step cannot be zero: {segment!r}")
                indices.update(range(*slice(*parts).indices(length)))
            else:
                idx = int(segment)
                if idx < -length or idx >= length:
                    raise ValueError(f"Index {idx} out of range for length {length}")
                indices.add(idx % length)
        except ValueError as e:
            if "out of range" in str(e) or "cannot be zero" in str(e):
                raise
            raise ValueError(f"Invalid slice segment: {segment!r}") from e

    if not indices:
        raise ValueError(f"Slice string {s!r} produced no indices")

    return sorted(indices)
