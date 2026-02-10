"""Tests for parse_slice_string."""

from __future__ import annotations

import pytest

from core import parse_slice_string


# ── "all" keyword ────────────────────────────────────────────────────────────

class TestAll:
    def test_all_lowercase(self):
        assert parse_slice_string("all", 5) == [0, 1, 2, 3, 4]

    def test_all_uppercase(self):
        assert parse_slice_string("ALL", 10) == list(range(10))

    def test_all_with_whitespace(self):
        assert parse_slice_string("  all  ", 3) == [0, 1, 2]


# ── single indices ───────────────────────────────────────────────────────────

class TestSingleIndices:
    def test_single_index(self):
        assert parse_slice_string("3", 10) == [3]

    def test_multiple_singles(self):
        assert parse_slice_string("1, 5, 3", 10) == [1, 3, 5]

    def test_duplicates_deduplicated(self):
        assert parse_slice_string("2, 2, 2", 10) == [2]

    def test_zero(self):
        assert parse_slice_string("0", 10) == [0]

    def test_last_valid(self):
        assert parse_slice_string("9", 10) == [9]


# ── negative indices ─────────────────────────────────────────────────────────

class TestNegativeIndices:
    def test_negative_one(self):
        assert parse_slice_string("-1", 10) == [9]

    def test_negative_length(self):
        assert parse_slice_string(f"-10", 10) == [0]

    def test_mixed_negative_positive(self):
        assert parse_slice_string("0, -1", 10) == [0, 9]


# ── slice segments ───────────────────────────────────────────────────────────

class TestSlices:
    def test_start_stop(self):
        assert parse_slice_string("0:5", 10) == [0, 1, 2, 3, 4]

    def test_start_stop_step(self):
        assert parse_slice_string("0:10:2", 10) == [0, 2, 4, 6, 8]

    def test_open_end(self):
        assert parse_slice_string("7:", 10) == [7, 8, 9]

    def test_open_start(self):
        assert parse_slice_string(":3", 10) == [0, 1, 2]

    def test_negative_start_open_end(self):
        assert parse_slice_string("-3:", 10) == [7, 8, 9]

    def test_full_range_slice(self):
        assert parse_slice_string(":", 10) == list(range(10))

    def test_slice_clamps_to_length(self):
        assert parse_slice_string("0:999", 10) == list(range(10))

    def test_negative_step(self):
        assert parse_slice_string("9:0:-1", 10) == [1, 2, 3, 4, 5, 6, 7, 8, 9]


# ── mixed segments ───────────────────────────────────────────────────────────

class TestMixed:
    def test_slices_and_singles(self):
        assert parse_slice_string("0:5, 10, 20:30:2", 50) == [
            0, 1, 2, 3, 4, 10, 20, 22, 24, 26, 28,
        ]

    def test_overlapping_ranges_deduplicated(self):
        assert parse_slice_string("0:5, 3:8", 10) == [0, 1, 2, 3, 4, 5, 6, 7]

    def test_whitespace_around_segments(self):
        assert parse_slice_string(" 1 , 2 , 3 ", 10) == [1, 2, 3]

    def test_trailing_comma_ignored(self):
        assert parse_slice_string("1, 2,", 10) == [1, 2]


# ── error cases ──────────────────────────────────────────────────────────────

class TestErrors:
    def test_out_of_range_positive(self):
        with pytest.raises(ValueError, match="out of range"):
            parse_slice_string("10", 10)

    def test_out_of_range_negative(self):
        with pytest.raises(ValueError, match="out of range"):
            parse_slice_string("-11", 10)

    def test_step_zero(self):
        with pytest.raises(ValueError, match="step cannot be zero"):
            parse_slice_string("0:10:0", 10)

    def test_non_integer(self):
        with pytest.raises(ValueError, match="Invalid slice segment"):
            parse_slice_string("abc", 10)

    def test_float_value(self):
        with pytest.raises(ValueError, match="Invalid slice segment"):
            parse_slice_string("1.5", 10)

    def test_empty_string(self):
        with pytest.raises(ValueError, match="produced no indices"):
            parse_slice_string("", 10)

    def test_only_commas(self):
        with pytest.raises(ValueError, match="produced no indices"):
            parse_slice_string(",,,", 10)
