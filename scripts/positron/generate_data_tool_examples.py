# ---------------------------------------------------------------------------------------------
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# ---------------------------------------------------------------------------------------------

from decimal import Decimal
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

# Example table with reasonably exhaustive list of pyarrow data types

column_specs = [
    (pa.null(), [None, None, None, None]),
    (pa.bool_(), [False, None, True, True]),
    (pa.int8(), [-1, 2, 3, None]),
    (pa.int16(), [-10000, 20000, 30000, None]),
    (pa.int32(), [-10000000, 2000000, 3000000, None]),
    (pa.int64(), [-10000000000, 2000000000, 3000000000, None]),
    (pa.uint8(), [0, 2, 3, None]),
    (pa.uint16(), [0, 2000, 3000, None]),
    (pa.uint32(), [0, 2000000, 3000000, None]),
    (pa.uint64(), [0, 2000000000, 3000000000, None]),
    (
        pa.float16(),
        [np.float16(-1.01234), np.float16(2.56789), np.float16(3.012345),
         None],
    ),
    (pa.float32(), [-1.01234, 2.56789, 3.012345, None]),
    (pa.float64(), [-1.01234, 2.56789, 3.012345, None]),
    # TODO (maybe): other units
    (pa.time32("s"), [0, 14400, 40271, None]),
    (pa.time64("us"), [0, 14400000000, 40271000000, None]),
    # TODO (maybe): other units
    (pa.timestamp("ms"), [1704394167126, 946730085000, 0, None]),
    (pa.timestamp("s", "America/New_York"), [1704394167, 946730085, 0, None]),
    (pa.date32(), [730120, 0, -1, None]),
    (pa.date64(), [1704390000000, 946730000000, 0, None]),
    # TODO (maybe): other units
    (pa.duration("s"), [0, 1, 2, None]),
    (pa.month_day_nano_interval(), [(0, 10, 0), (1, 0, 30), (0, 0, 0), None]),
    (pa.binary(), [b"testing", b"some", b"strings", None]),
    (pa.binary(5), [b"01000", b"abcde", b"_____", None]),
    (pa.string(), ["tésting", "söme", "strîngs", None]),
    (pa.large_binary(), [b"testing", b"some", b"strings", None]),
    (pa.large_string(), ["tésting", "söme", "strîngs", None]),
    (pa.large_utf8(), ["tésting", "süme", "strîngs", None]),
    (
        pa.decimal128(12, 4),
        [Decimal("123.4501"), Decimal("0"), Decimal("12345678.4501"), None],
    ),
    (
        pa.decimal256(12, 4),
        [Decimal("123.4501"), Decimal("0"), Decimal("12345678.4501"), None],
    ),
    (
        pa.list_(pa.field("item", pa.int32(), nullable=True)),
        [[], [1, None, 3], [0], None],
    ),
    # (pa.map_(pa.string(), pa.int32()), []),
    # (pa.struct([pa.field('a', 'int32'), pa.field('b', 'bool')]),
    # (pa.dictionary(pa.int32(), pa.string()), []),
    # TODO(wesm): Add example of RLE type
    # (pa.run_end_encoded
]

# TODO: Exclude types that are not supported for writing to Parquet

UNSUPPORTED_PARQUET_TYPES = {pa.float16(), pa.month_day_nano_interval()}

N_REPEATS = 1000

column_data = []
column_types = []
for i, (col_type, values) in enumerate(column_specs):
    if col_type in UNSUPPORTED_PARQUET_TYPES:
        continue
    if not isinstance(values, pa.Array):
        values = pa.array(values, type=col_type)

    values = pa.concat_arrays([values] * N_REPEATS)

    column_data.append(values)
    column_types.append(pa.field(f"column_{i}", col_type))

table = pa.Table.from_arrays(column_data, schema=pa.schema(column_types))
pq.write_table(table, "pyarrow_all_types.parquet")
