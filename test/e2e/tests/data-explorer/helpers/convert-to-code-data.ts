/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


/**
 * Sample Data Table used in code generation tests
 *
 * | name    | age | city    | state  | is_student | enrollment_date  | score | grade | status    |
 * |---------|-----|---------|--------|------------|------------------|-------|-------|-----------|
 * | Alice   | 25  | Austin  | Texas  | true       | 2023-01-01       | 89.5  | B+    | active    |
 * | Bob     | 35  | Dallas  | Texas  | false      | --               | --    | A     | inactive  |
 * | Charlie | 40  | Austin  | Texas  | false      | 2021-07-15       | 95.0  | A+    | active    |
 * | Diana   | --  | Houston | Texas  | true       | 2022-09-30       | 76.0  | --    | on leave  |
 *
 *  "--" represents missing values in each language:
 *   - Python (pandas): None / pd.NaT
 *   - Python (polars): None
 *   - R: NA
 */


export const pandasDataFrameScript = `
import pandas as pd

df = pd.DataFrame({
  "name": ["Alice", "Bob", "Charlie", "Diana"],
  "age": [25, 35, 40, None],
  "city": ["Austin", "Dallas", "Austin", "Houston"],
  "state": ["Texas", "Texas", "Texas", "Texas"],
  "is_student": [True, False, False, True],
  "enrollment_date": pd.to_datetime(["2023-01-01", None, "2021-07-15", "2022-09-30"]),
  "score": [89.5, None, 95.0, 76.0],
  "grade": ["B+", "A", "A+", None],
  "status": pd.Categorical(["active", "inactive", "active", "on leave"]),
})
`;

export const polarsDataFrameScript = `
import polars as pl

df = pl.DataFrame({
  "name": ["Alice", "Bob", "Charlie", "Diana"],
  "age": [25, 35, 40, None],
  "city": ["Austin", "Dallas", "Austin", "Houston"],
  "state": ["Texas", "Texas", "Texas", "Texas"],
  "is_student": [True, False, False, True],
  "enrollment_date": pl.date_range(
    low="2021-07-15",
    high="2023-01-01",
    interval="1y",
    eager=True
).to_list() + [None],  # Add NA manually to match Bob
  "score": [89.5, None, 95.0, 76.0],
  "grade": ["B+", "A", "A+", None],
  "status": pl.Series("status", ["active", "inactive", "active", "on leave"]).cast(pl.Categorical),
})
`;

export const rDataFrameScript = `
df <- data.frame(
  name = c("Alice", "Bob", "Charlie", "Diana"),
  age = c(25, 35, 40, NA),
  city = c("Austin", "Dallas", "Austin", "Houston"),
  state = c("Texas", "Texas", "Texas", "Texas"),
  is_student = c(TRUE, FALSE, FALSE, TRUE),
  enrollment_date = as.Date(c("2023-01-01", NA, "2021-07-15", "2022-09-30")),
  score = c(89.5, NA, 95.0, 76.0),
  grade = c("B+", "A", "A+", NA),
  status = factor(c("active", "inactive", "active", "on leave")),
  stringsAsFactors = FALSE
)
`;

export const tibbleScript = `
library(tibble)

df <- tibble(
  name = c("Alice", "Bob", "Charlie", "Diana"),
  age = c(25, 35, 40, NA),
  city = c("Austin", "Dallas", "Austin", "Houston"),
  state = c("Texas", "Texas", "Texas", "Texas"),
  is_student = c(TRUE, FALSE, FALSE, TRUE),
  enrollment_date = as.Date(c("2023-01-01", NA, "2021-07-15", "2022-09-30")),
  score = c(89.5, NA, 95.0, 76.0),
  grade = c("B+", "A", "A+", NA),
  status = factor(c("active", "inactive", "active", "on leave")),
)
`;

export const dataTableScript = `
library(data.table)

df <- data.table(
  name = c("Alice", "Bob", "Charlie", "Diana"),
  age = c(25, 35, 40, NA),
  city = c("Austin", "Dallas", "Austin", "Houston"),
  state = c("Texas", "Texas", "Texas", "Texas"),
  is_student = c(TRUE, FALSE, FALSE, TRUE),
  enrollment_date = as.Date(c("2023-01-01", NA, "2021-07-15", "2022-09-30")),
  score = c(89.5, NA, 95.0, 76.0),
  grade = c("B+", "A", "A+", NA),
  status = factor(c("active", "inactive", "active", "on leave")),
)
`;
