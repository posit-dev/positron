"""
Internal utilities for the Data Explorer.

This module provides implementations of data analysis functions for both
NumPy and Polars to handle cases where one or the other may not be available.
"""

import math
import warnings
from typing import TYPE_CHECKING, Optional, Tuple

if TYPE_CHECKING:
    import polars as pl

# Constants
_EMPTY_HISTOGRAM = ([], [0.0, 1.0])


def _is_polars_integer_type(dtype) -> bool:
    """Check if a Polars dtype is an integer type."""
    import polars as pl

    return dtype in [
        pl.Int8,
        pl.Int16,
        pl.Int32,
        pl.Int64,
        pl.UInt8,
        pl.UInt16,
        pl.UInt32,
        pl.UInt64,
    ]


def _calculate_sqrt_fallback_binwidth(data_range: float, n: int) -> float:
    """Calculate fallback bin width using sqrt method."""
    return data_range / math.sqrt(n) if n > 0 else data_range


def _calculate_fd_binwidth(data, data_range: float, n: int) -> float:
    """Calculate Freedman-Diaconis bin width with sqrt fallback."""
    q75 = data.quantile(0.75)
    q25 = data.quantile(0.25)
    iqr = q75 - q25
    if iqr > 0:
        return 2.0 * iqr * (n ** (-1.0 / 3.0))
    else:
        return _calculate_sqrt_fallback_binwidth(data_range, n)


def _convert_object_series_to_float(data: "pl.Series") -> "Optional[pl.Series]":
    """Convert object dtype Series to Float64, returning None if conversion fails."""
    import polars as pl

    try:

        def safe_float_convert(val):
            if val is None:
                return None
            try:
                return float(val)
            except (ValueError, TypeError):
                return None

        return data.map_elements(safe_float_convert, return_dtype=pl.Float64)
    except Exception:
        return None


def _get_histogram_method(method):
    """Convert histogram method enum to string."""
    from .data_explorer_comm import ColumnHistogramParamsMethod

    return {
        ColumnHistogramParamsMethod.Fixed: "fixed",
        ColumnHistogramParamsMethod.Sturges: "sturges",
        ColumnHistogramParamsMethod.FreedmanDiaconis: "fd",
        ColumnHistogramParamsMethod.Scott: "scott",
    }[method]


def _get_histogram_numpy(data, num_bins, method="fd", *, to_numpy=False):
    """
    Compute histogram using NumPy.

    This is the original implementation that requires NumPy to be installed.
    """
    try:
        import numpy as np
    except ModuleNotFoundError as e:
        # If NumPy is not installed, we cannot compute histograms
        from .data_explorer import DataExplorerWarning

        warnings.warn(
            "Numpy not installed, histogram computation will not work. "
            "Please install NumPy to enable this feature.",
            category=DataExplorerWarning,
            stacklevel=1,
        )
        raise e

    if to_numpy:
        data = data.to_numpy()

    assert num_bins is not None
    hist_params = {"bins": num_bins} if method == "fixed" else {"bins": method}

    if data.dtype == object:
        # For decimals, we convert to float which is lossy but works for now
        return _get_histogram_numpy(data.astype(float), num_bins, method=method)

    # We optimistically compute the histogram once, and then do extra
    # work in the special cases where the binning method produces a
    # finer-grained histogram than the maximum number of bins that we
    # want to render, as indicated by the num_bins argument
    try:
        bin_counts, bin_edges = np.histogram(data, **hist_params)
    except ValueError:
        if issubclass(data.dtype.type, np.integer):
            # Issue #5176. There is a class of error for integers where np.histogram
            # will fail on Windows (platform int issue), e.g. this array fails with Numpy 2.1.1
            # array([ -428566661,  1901704889,   957355142,  -401364305, -1978594834,
            #         519144975,  1384373326,  1974689646,   194821408, -1564699930],
            #         dtype=int32)
            # So we try again with the data converted to floating point as a fallback
            return _get_histogram_numpy(data.astype(np.float64), num_bins, method=method)

        # If there are inf/-inf values in the dataset, ValueError is
        # raised. We catch it and try again to avoid paying the
        # filtering cost every time
        data = data[np.isfinite(data)]
        bin_counts, bin_edges = np.histogram(data, **hist_params)

    need_recompute = False

    # If the method returns more bins than what the front-end requested,
    # we re-define the bin edges.
    if len(bin_edges) > num_bins:
        hist_params = {"bins": num_bins}
        need_recompute = True

    # For integers, we want to make sure the number of bins is smaller
    # then than `data.max() - data.min()`, so we don't endup with more bins
    # then there's data to display.
    # hist_params = {"bins": bin_edges.tolist()}
    if issubclass(data.dtype.type, np.integer):
        # Avoid overflows with smaller integers
        width = (data.max().astype(np.int64) - data.min().astype(np.int64)).item()
        if len(bin_edges) > width and width > 0:
            hist_params = {"bins": width + 1}
            need_recompute = True

    if need_recompute:
        bin_counts, bin_edges = np.histogram(data, **hist_params)

    # Special case: if we have a single bin, check if all values are the same
    # If so, override the bin edges to be the same value instead of value +/- 0.5
    if len(bin_counts) == 1 and len(data) > 0:
        # Check if all non-null values are the same
        unique_values = np.unique(data)
        if len(unique_values) == 1:
            # All values are the same, set bin edges to [value, value]
            bin_edges = np.array([unique_values[0], unique_values[0]])

    return bin_counts, bin_edges


def _get_histogram_polars(
    data: "pl.Series", num_bins: int, method: str = "fd"
) -> Tuple[list, list]:
    """
    Compute histogram using Polars operations instead of NumPy.

    This function provides consistent behavior with NumPy's histogram function
    but uses Polars for computation when NumPy is not available.

    Parameters
    ----------
    data : pl.Series
        Input data as a Polars Series
    num_bins : int
        Maximum number of bins to use
    method : str
        Binning method: 'fixed', 'fd', 'sturges', 'auto', 'scott', 'rice', 'sqrt', 'doane'

    Returns
    -------
    bin_counts : list
        The counts for each bin
    bin_edges : list
        The edges of the bins (length = len(bin_counts) + 1)
    """
    import polars as pl

    # Convert to Polars Series if needed
    if not isinstance(data, pl.Series):
        data = pl.Series(data)

    # Handle object dtype (like Decimals) by converting to float
    if data.dtype == pl.Object:
        # For decimals and other objects, convert to float which is lossy but works for now
        data_converted = _convert_object_series_to_float(data)
        if data_converted is None:
            # If conversion fails, return empty histogram
            return _EMPTY_HISTOGRAM
        data = data_converted

    # Remove null values
    data = data.drop_nulls()

    if len(data) == 0:
        # Return empty histogram for empty data
        return _EMPTY_HISTOGRAM

    # Filter out infinite values
    if data.dtype in [pl.Float32, pl.Float64]:
        data = data.filter(data.is_finite())
        if len(data) == 0:
            return _EMPTY_HISTOGRAM

    # Get data statistics
    min_val = data.min()
    max_val = data.max()

    # Handle single value case
    if min_val == max_val:
        # All values are the same
        return [len(data)], [min_val, min_val]

    # Calculate optimal number of bins based on method
    n = len(data)
    data_range = max_val - min_val

    if method == "fixed":
        n_bins = num_bins
    else:
        # Calculate bin width based on method
        if method == "fd":  # Freedman-Diaconis
            bin_width = _calculate_fd_binwidth(data, data_range, n)
        elif method == "sturges":
            n_bins_sturges = math.ceil(math.log2(n)) + 1
            bin_width = data_range / n_bins_sturges
        elif method == "scott":
            std_dev = data.std()
            if std_dev > 0:
                bin_width = 3.5 * std_dev * (n ** (-1.0 / 3.0))
            else:
                bin_width = _calculate_sqrt_fallback_binwidth(data_range, n)
        elif method == "rice":
            n_bins_rice = math.ceil(2 * (n ** (1.0 / 3.0)))
            bin_width = data_range / n_bins_rice
        elif method == "sqrt":
            n_bins_sqrt = math.ceil(math.sqrt(n))
            bin_width = data_range / n_bins_sqrt
        elif method == "doane":
            # Doane's method accounts for skewness
            # g1 = skewness
            mean_val = data.mean()
            std_dev = data.std()
            if std_dev > 0:
                # Calculate skewness manually
                centered = (data - mean_val) / std_dev
                g1 = (centered**3).mean()
                # Standard error of skewness
                sg1 = math.sqrt(6.0 * (n - 2) / ((n + 1) * (n + 3)))
                k = 1 + math.log2(n) + math.log2(1 + abs(g1) / sg1) if sg1 > 0 else 1 + math.log2(n)
            else:
                k = 1 + math.log2(n)
            n_bins_doane = math.ceil(k)
            bin_width = data_range / n_bins_doane
        elif method == "auto":
            # Use minimum of FD and Sturges (with sqrt correction for FD)
            # FD with correction
            fd_bw = _calculate_fd_binwidth(data, data_range, n)
            sqrt_bw = _calculate_sqrt_fallback_binwidth(data_range, n)
            fd_bw_corrected = max(fd_bw, sqrt_bw / 2)

            # Sturges
            n_bins_sturges = math.ceil(math.log2(n)) + 1
            sturges_bw = data_range / n_bins_sturges

            bin_width = min(fd_bw_corrected, sturges_bw)
        else:
            raise ValueError(f"Unknown binning method: {method}")

        # Calculate number of bins from bin width
        n_bins = math.ceil(data_range / bin_width) if bin_width > 0 else 1

    # Limit to maximum number of bins
    n_bins = min(n_bins, num_bins)

    # For integer data, ensure bins don't exceed the integer range
    if _is_polars_integer_type(data.dtype):
        # Ensure we don't have more bins than the integer range
        int_range = int(max_val - min_val)
        if int_range > 0 and n_bins > int_range:
            n_bins = min(n_bins, int_range + 1)

    # Ensure at least 1 bin
    n_bins = max(1, n_bins)

    # Create bin edges
    if n_bins == 1:
        # Single bin case
        bin_edges = [min_val, min_val] if min_val == max_val else [min_val, max_val]
    else:
        # Create evenly spaced bins
        bin_width = (max_val - min_val) / n_bins
        bin_edges = [min_val + i * bin_width for i in range(n_bins + 1)]
        # Ensure the last edge exactly matches max_val to avoid floating point issues
        bin_edges[-1] = max_val

    # Compute bin indices for each value using efficient vectorized operations and group_by

    # Handle edge case: if only one bin edge (degenerate case)
    if len(bin_edges) <= 1:
        bin_counts = []
    elif len(bin_edges) == 2:
        # Single bin case
        bin_counts = [len(data)]
    else:
        # Compute bin width for uniform bins
        bin_width = (bin_edges[-1] - bin_edges[0]) / (len(bin_edges) - 1)

        # Create a DataFrame to work with expressions and compute bin indices in one step
        max_bin_idx = len(bin_edges) - 2  # Last valid bin index

        df_for_groupby = pl.DataFrame({"value": data}).with_columns(
            [
                # Compute bin indices: (value - min_edge) / bin_width, then handle edge cases
                pl.when(pl.col("value") >= bin_edges[-1])
                .then(pl.lit(max_bin_idx))  # Values at max edge go in last bin
                .otherwise(
                    ((pl.col("value") - bin_edges[0]) / bin_width)
                    .floor()
                    .cast(pl.Int32)
                    .clip(0, max_bin_idx)  # Clip out-of-bounds indices
                )
                .alias("bin_idx")
            ]
        )

        # Use groupby to count efficiently - O(N log N) or better
        bin_counts_df = (
            df_for_groupby.group_by("bin_idx")
            .agg(pl.col("value").count().alias("count"))
            .sort("bin_idx")
        )

        # Convert to the final bin_counts list, filling in zeros for missing bins
        observed_bins = bin_counts_df["bin_idx"].to_list()
        observed_counts = bin_counts_df["count"].to_list()

        # Create the final bin_counts array with zeros for unobserved bins
        bin_counts = [0] * (len(bin_edges) - 1)
        for bin_idx, count in zip(observed_bins, observed_counts):
            if 0 <= bin_idx < len(bin_counts):  # Safety check
                bin_counts[bin_idx] = count

    # Special case: if we have a single bin, check if all values are the same
    # If so, override the bin edges to be the same value instead of value +/- 0.5
    if len(bin_counts) == 1 and len(data) > 0:
        # Check if all non-null values are the same
        unique_count = data.n_unique()
        if unique_count == 1:
            # All values are the same, set bin edges to [value, value]
            unique_value = data[0]  # Get the single unique value
            bin_edges = [unique_value, unique_value]

    return bin_counts, bin_edges
