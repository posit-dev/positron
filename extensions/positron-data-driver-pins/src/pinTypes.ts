/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The pin storage types that can be previewed in the Data Explorer, mapped to the DuckDB table
 * function that reads them. The Data Explorer preview downloads the pin's data file and queries it
 * with DuckDB, so only formats DuckDB reads natively are previewable. Arrow is intentionally absent:
 * the bundled DuckDB has no `read_arrow`. Other pin types (rds, qs2, joblib, json, file) are not
 * tabular files DuckDB can scan, so they stay non-previewable and are reached via generated code.
 */
const DUCKDB_READERS: Readonly<Record<string, string>> = {
	parquet: 'read_parquet',
	csv: 'read_csv_auto',
};

/**
 * Returns the DuckDB table function that reads a pin of the given storage type, or undefined when
 * the type is not previewable.
 */
export function duckdbReaderForPinType(type: string | undefined): string | undefined {
	return type === undefined ? undefined : DUCKDB_READERS[type];
}

/** Whether a pin of the given storage type can be previewed in the Data Explorer. */
export function isPreviewablePinType(type: string | undefined): boolean {
	return duckdbReaderForPinType(type) !== undefined;
}
