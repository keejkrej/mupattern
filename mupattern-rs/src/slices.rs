/// Parse slice expressions like "all", "1,3", "0:10:2".
/// Semantics mirror muapplication/common/slices.py (slice.indices).
pub fn parse_slice_string(s: &str, length: usize) -> Result<Vec<usize>, String> {
    let s = s.trim();
    if s.eq_ignore_ascii_case("all") {
        return Ok((0..length).collect());
    }

    let len = length as isize;
    let mut indices = std::collections::HashSet::new();

    for segment in s.split(',') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        if segment.contains(':') {
            let parts: Vec<Option<isize>> = segment
                .split(':')
                .map(|p| {
                    let t = p.trim();
                    if t.is_empty() {
                        Ok(None)
                    } else {
                        t.parse()
                            .map_err(|_| format!("Invalid slice segment: {:?}", segment))
                            .map(Some)
                    }
                })
                .collect::<Result<_, _>>()?;
            if parts.len() > 3 {
                return Err(format!("Invalid slice segment: {:?}", segment));
            }
            let start = parts.get(0).copied().flatten().unwrap_or(0);
            let stop = parts.get(1).copied().flatten().unwrap_or(len);
            let step = parts.get(2).copied().flatten().unwrap_or(1);

            if step == 0 {
                return Err(format!("Slice step cannot be zero: {:?}", segment));
            }

            let (start, stop, step) = (start, stop, step);
            let (i, j, k) = slice_indices(start, stop, step, len);
            let mut idx = i;
            while (k > 0 && idx < j) || (k < 0 && idx > j) {
                if idx >= 0 && idx < len {
                    indices.insert(idx as usize);
                }
                idx += k;
            }
        } else {
            let idx: isize = segment
                .parse()
                .map_err(|_| format!("Invalid slice segment: {:?}", segment))?;
            if idx < -len || idx >= len {
                return Err(format!("Index {} out of range", idx));
            }
            let idx = if idx < 0 { idx + len } else { idx };
            indices.insert(idx as usize);
        }
    }

    let mut out: Vec<usize> = indices.into_iter().collect();
    out.sort_unstable();
    Ok(out)
}

/// Mirror Python slice.indices(length) -> (start, stop, step).
fn slice_indices(start: isize, stop: isize, step: isize, length: isize) -> (isize, isize, isize) {
    let (mut start, mut stop) = (start, stop);
    if start < 0 {
        start = (start + length).max(0);
    } else if start > length {
        start = length;
    }
    if stop < 0 {
        stop = (stop + length).max(0);
    } else if stop > length {
        stop = length;
    }
    if step < 0 {
        if stop < start {
            (start, stop.max(-1), step)
        } else {
            (start, -1, step)
        }
    } else {
        if start > stop {
            (start, stop, step)
        } else {
            (start, stop, step)
        }
    }
}
