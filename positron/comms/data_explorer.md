<!---
  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
-->

# Data Explorer OpenRPC Protocol

## Backend Methods

### get_state

The `get_state` method returns the current backend state including table metadata and optional formatting options.

#### Format Options

The backend can optionally provide `format_options` in the state to control how numeric values are displayed. This allows backends to respect language-specific settings (e.g., R's `scipen` option).

Format options include:
* `large_num_digits`: Fixed number of decimal places for numbers over 1 or in scientific notation
* `small_num_digits`: Fixed number of decimal places for small numbers and threshold for scientific notation
* `max_integral_digits`: Maximum integral digits before switching to scientific notation
* `max_value_length`: Maximum formatted value length for truncation
* `thousands_sep`: Optional thousands separator character

If format_options is not provided, the frontend will use sensible defaults.

### get_data_values

Non-special values are returned formatted as strings.

Special values such as `NULL`, `NA`, etc. are encoded with integer codes.
The currently supported special value codes are:

* NULL: 0
* NA: 1
* NaN (Not a number): 2
* NaT (Not a time): 3
* None (such as Python None): 4
* +INF: 10
* -INF: 11
