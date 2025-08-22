"""
Unit tests for _data_explorer_internal.py

Tests the Polars-based histogram implementation and verifies consistency
with NumPy implementation across various data types and edge cases.
"""

import math
import pytest
import polars as pl
from positron._data_explorer_internal import (
    _get_histogram_polars,
    _get_histogram_numpy,
    _get_histogram_method,
)


def _assert_histogram_valid(data, bin_counts, bin_edges):
    """Helper function to validate basic histogram properties."""
    assert len(bin_edges) == len(bin_counts) + 1
    assert sum(bin_counts) == len(data)

    # Check bins are ordered
    for i in range(len(bin_edges) - 1):
        assert bin_edges[i] <= bin_edges[i + 1]


def _get_test_histogram(data_values, num_bins=10, method="fixed", dtype=None):
    """Helper function to create test data and get histogram."""
    data = pl.Series(data_values, dtype=dtype) if dtype else pl.Series(data_values)
    return _get_histogram_polars(data, num_bins=num_bins, method=method)


def test_histogram_polars_basic():
    """Test basic histogram functionality with Polars."""
    # Simple integer data
    data_values = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4]
    bin_counts, bin_edges = _get_test_histogram(data_values, num_bins=4)

    assert len(bin_counts) == 4
    assert len(bin_edges) == 5
    assert sum(bin_counts) == len(data_values)
    assert bin_edges[0] == 1
    assert bin_edges[-1] == 4


def test_histogram_polars_empty_data():
    """Test histogram with empty data."""
    bin_counts, bin_edges = _get_test_histogram([], dtype=pl.Float64)

    assert len(bin_counts) == 0
    assert bin_edges == [0.0, 1.0]


def test_histogram_polars_single_value():
    """Test histogram with all identical values."""
    bin_counts, bin_edges = _get_test_histogram([5.0] * 100)

    assert len(bin_counts) == 1
    assert bin_counts[0] == 100
    assert bin_edges == [5.0, 5.0]


def test_histogram_polars_single_bin_special_case():
    """Test the single-bin special case where all values are the same."""
    test_cases = [
        ([42] * 10, 42),  # Integer
        ([3.14] * 5, 3.14),  # Float
        ([0] * 3, 0),  # Zero
        ([-1.5] * 7, -1.5),  # Negative
    ]

    for values, expected_value in test_cases:
        bin_counts, bin_edges = _get_test_histogram(values)

        assert len(bin_counts) == 1, f"Expected 1 bin, got {len(bin_counts)} for {values}"
        assert bin_counts[0] == len(values), f"Expected count {len(values)}, got {bin_counts[0]}"
        assert bin_edges == [expected_value, expected_value], (
            f"Expected edges [{expected_value}, {expected_value}], got {bin_edges}"
        )


def test_histogram_polars_with_nulls():
    """Test histogram with null values."""
    bin_counts, bin_edges = _get_test_histogram([1, 2, None, 3, None, 4, 5], num_bins=5)

    # Nulls should be excluded
    assert sum(bin_counts) == 5
    assert bin_edges[0] == 1
    assert bin_edges[-1] == 5


def test_histogram_polars_with_inf():
    """Test histogram with infinite values."""
    data_with_inf = [1.0, 2.0, float("inf"), 3.0, float("-inf"), 4.0, 5.0]
    bin_counts, bin_edges = _get_test_histogram(data_with_inf, num_bins=5)

    # Infinities should be excluded
    assert sum(bin_counts) == 5
    assert bin_edges[0] == 1.0
    assert bin_edges[-1] == 5.0


def test_histogram_polars_integer_data():
    """Test histogram with integer data."""
    # Small integer range
    data_values = [1, 1, 2, 2, 2, 3, 3, 3, 3]
    bin_counts, bin_edges = _get_test_histogram(data_values, dtype=pl.Int32)

    # Should not create more bins than the integer range
    assert len(bin_counts) <= 3
    assert sum(bin_counts) == 9


def test_histogram_polars_methods():
    """Test different binning methods."""
    import numpy as np

    # Generate some normally distributed data
    np.random.seed(42)
    data_values = np.random.randn(1000).tolist()

    methods = ["fixed", "fd", "sturges", "scott", "rice", "sqrt", "doane", "auto"]

    for method in methods:
        bin_counts, bin_edges = _get_test_histogram(data_values, num_bins=50, method=method)
        _assert_histogram_valid(data_values, bin_counts, bin_edges)

        # Additional checks for method-specific behavior
        data_series = pl.Series(data_values)
        assert bin_edges[0] <= data_series.min()
        assert bin_edges[-1] >= data_series.max()


def test_histogram_consistency_with_numpy():
    """Test that Polars and NumPy implementations produce similar results."""
    import numpy as np

    # Skip if NumPy is not available
    pytest.importorskip("numpy")

    # Test various data distributions
    np.random.seed(42)
    test_distributions = [
        np.random.uniform(0, 10, 1000),  # Uniform distribution
        np.random.randn(1000),  # Normal distribution
        np.random.randint(0, 100, 500),  # Integer data
        np.random.exponential(2, 800),  # Skewed data
    ]

    for values in test_distributions:
        # Test with fixed bins
        counts_pl, edges_pl = _get_test_histogram(values.tolist(), num_bins=20)
        counts_np, edges_np = _get_histogram_numpy(values, num_bins=20, method="fixed")

        # Check that results are very close
        assert len(counts_pl) == len(counts_np)
        assert len(edges_pl) == len(edges_np)

        # Edge values should be very close
        for i in range(len(edges_pl)):
            assert abs(edges_pl[i] - edges_np[i]) < 1e-10

        # Counts should match exactly for fixed bins
        for i in range(len(counts_pl)):
            assert counts_pl[i] == counts_np[i]


def test_histogram_edge_cases():
    """Test various edge cases."""
    edge_cases = [
        # Very small range
        ([1.0, 1.0001, 1.0002], 3, None),
        # Large integer values
        ([1000000, 1000001, 1000002], 3, pl.Int64),
        # Negative values
        ([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], 11, None),
    ]

    for data_values, expected_count, dtype in edge_cases:
        bin_counts, bin_edges = _get_test_histogram(
            data_values, num_bins=len(data_values), dtype=dtype
        )
        assert sum(bin_counts) == expected_count

    # Test specific edge boundaries
    bin_counts, bin_edges = _get_test_histogram([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5])
    assert bin_edges[0] == -5
    assert bin_edges[-1] == 5


def test_histogram_datetime_data():
    """Test histogram with datetime data after casting."""
    from datetime import datetime, timedelta

    # Create datetime series
    base = datetime(2024, 1, 1)
    dates = [base + timedelta(days=i) for i in range(100)]
    data = pl.Series(dates)

    # Cast to int64 as done in PolarsView
    data_int = data.cast(pl.Int64)
    bin_counts, bin_edges = _get_histogram_polars(data_int, num_bins=10, method="fixed")

    assert sum(bin_counts) == 100
    assert len(bin_edges) == 11


def test_histogram_categorical_error():
    """Test that categorical data raises appropriate error or is handled."""
    data = pl.Series(["A", "B", "C", "A", "B"], dtype=pl.Categorical)

    # The histogram should not work with categorical data
    from polars.exceptions import ComputeError

    with pytest.raises((ValueError, TypeError, ComputeError)):
        _get_histogram_polars(data, num_bins=5, method="fixed")


def test_histogram_method_parameter():
    """Test the _get_histogram_method helper function."""
    from positron.data_explorer_comm import ColumnHistogramParamsMethod

    method_mappings = [
        (ColumnHistogramParamsMethod.Fixed, "fixed"),
        (ColumnHistogramParamsMethod.Sturges, "sturges"),
        (ColumnHistogramParamsMethod.FreedmanDiaconis, "fd"),
        (ColumnHistogramParamsMethod.Scott, "scott"),
    ]

    for enum_value, expected_string in method_mappings:
        assert _get_histogram_method(enum_value) == expected_string


def test_histogram_polars_decimal_data():
    """Test histogram with decimal/high precision data."""
    from decimal import Decimal

    # Polars handles Decimal as Float64
    decimal_values = [Decimal("1.1"), Decimal("2.2"), Decimal("3.3")]
    data = pl.Series(decimal_values).cast(pl.Float64)  # Cast as would be done in practice

    bin_counts, bin_edges = _get_histogram_polars(data, num_bins=3, method="fixed")
    assert sum(bin_counts) == 3


def test_histogram_polars_performance():
    """Test that Polars histogram performs well with large datasets."""
    import time

    # Large dataset
    large_data = list(range(1000000))

    start = time.time()
    bin_counts, bin_edges = _get_test_histogram(large_data, num_bins=100)
    elapsed = time.time() - start

    # Should complete in reasonable time (< 1 second for 1M values)
    assert elapsed < 1.0
    assert sum(bin_counts) == 1000000


def test_histogram_sparse_bins():
    """Test histogram with data that doesn't fill all bins (zero-filling test)."""
    # Data that will leave gaps in the histogram
    sparse_data = [1, 1, 1, 9, 9, 9]  # Only uses first and last bins
    bin_counts, bin_edges = _get_test_histogram(sparse_data, num_bins=5)

    # Should have 5 bins with zeros in the middle
    assert len(bin_counts) == 5
    assert sum(bin_counts) == 6  # Total data points
    assert bin_counts[0] > 0  # First bin has data
    assert bin_counts[-1] > 0  # Last bin has data

    # Middle bins should be zero (this tests the zero-filling logic)
    middle_bins_sum = sum(bin_counts[1:-1])
    assert middle_bins_sum == 0, f"Expected middle bins to be zero, got {bin_counts}"
