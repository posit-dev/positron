/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export const pandasDataFrameScript = `
import pandas as pd
df = pd.DataFrame({
	"name": ["Alice", "Bob", "Charlie", "Diana"],
	"age": [25, 35, 40, None],
	"city": ["Austin", "Dallas", "Austin", "Houston"]
})
`;

export const polarsDataFrameScript = `
import polars as pl
df = pl.DataFrame({
	"name": ["Alice", "Bob", "Charlie", "Diana"],
	"age": [25, 35, 40, None],
	"city": ["Austin", "Dallas", "Austin", "Houston"]
})
`;

export const rDataFrameScript = `
df <- data.frame(
  name = c("Alice", "Bob", "Charlie", "Diana"),
  age = c(25, 35, 40, NA),
  city = c("Austin", "Dallas", "Austin", "Houston"),
  stringsAsFactors = FALSE
)
`;

export const tibbleScript = `
library(tibble)
df <- tibble(
  name = c("Alice", "Bob", "Charlie", "Diana"),
  age = c(25, 35, 40, NA),
  city = c("Austin", "Dallas", "Austin", "Houston")
)
`;

export const dataTableScript = `
library(data.table)
df <- data.table(
  name = c("Alice", "Bob", "Charlie", "Diana"),
  age = c(25, 35, 40, NA),
  city = c("Austin", "Dallas", "Austin", "Houston")
)
`;
