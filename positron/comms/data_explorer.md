<!---
  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
-->

# Data Explorer OpenRPC Protocol

## Backend Methods

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
