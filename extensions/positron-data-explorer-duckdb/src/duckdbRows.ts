/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DuckDBDecimalValue, DuckDBResultReader, DuckDBValueConverter, JS, JSDuckDBValueConverter } from '@duckdb/node-api';

/**
 * Converts DuckDB values to plain JS the way `getRowObjectsJS` does, except that a DECIMAL becomes
 * its exact digit string rather than a double. A double cannot hold a wide DECIMAL, and once the
 * value has been rounded nothing downstream can recover the digits, so the formatter's exact
 * decimal path depends on receiving the string. The converter is passed down to nested values, so
 * a DECIMAL inside a LIST or STRUCT is kept exact too.
 */
const exactDecimalConverter: DuckDBValueConverter<JS> = (value, type, converter) =>
	value instanceof DuckDBDecimalValue ? value.toString() : JSDuckDBValueConverter(value, type, converter);

/**
 * Materializes a result's rows as plain JS objects keyed by column name, so they can cross the IPC
 * boundary to the host. Every value is a plain JS type (string, number, bigint, Date, Uint8Array,
 * null, or arrays and objects of these), all of which survive V8 "advanced" serialization; the
 * DuckDB value classes would not, as structured clone strips their prototypes.
 */
export function materializeRows(reader: DuckDBResultReader): Array<Record<string, JS>> {
	return reader.convertRowObjects(exactDecimalConverter);
}
