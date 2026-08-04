/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Databricks SQL dialect helpers shared by the schema tree, the Data Explorer table view, and the
// RPC handler: identifier/literal quoting, object references, and the column metadata read.
//
// Column metadata comes from `DESCRIBE TABLE` rather than `information_schema.columns` because
// information_schema exists only under Unity Catalog -- a workspace's legacy `hive_metastore`
// catalog has none, and browsing it is still a supported case. DESCRIBE works for both, needs no
// catalog-specific SQL, and returns a ready-formatted type string (e.g. `decimal(10,2)`,
// `array<int>`), so no type assembly from parts is needed.

import { ColumnDisplayType } from 'positron-data-explorer-protocol';

/**
 * Quotes and escapes an identifier for Databricks SQL. Databricks delimits identifiers with
 * backticks and escapes an embedded backtick by doubling it.
 */
export function quoteIdentifier(name: string): string {
	return '`' + name.replace(/`/g, '``') + '`';
}

/**
 * Escapes a value for use inside a single-quoted Databricks string literal. Databricks processes
 * backslash escape sequences inside string literals by default
 * (`spark.sql.parser.escapedStringLiterals` is false), so both backslashes and single quotes are
 * escaped.
 */
export function quoteLiteral(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, '\'\'');
}

/**
 * Wraps a generated column alias in backticks. Unquoted identifiers in Databricks are
 * case-insensitive but case-preserving, so this is belt-and-braces: it guarantees the result row is
 * keyed by exactly the alias string the reading code uses.
 */
export function quoteAlias(alias: string): string {
	return '`' + alias + '`';
}

/** Builds a backtick-quoted two-part `` `catalog`.`schema` `` reference. */
function schemaRef(catalog: string, schemaName: string): string {
	return `${quoteIdentifier(catalog)}.${quoteIdentifier(schemaName)}`;
}

/** Builds a backtick-quoted three-part `` `catalog`.`schema`.`table` `` reference. */
export function tableRef(catalog: string, schemaName: string, tableName: string): string {
	return `${schemaRef(catalog, schemaName)}.${quoteIdentifier(tableName)}`;
}

/** A column of a Databricks table or view, as reported by DESCRIBE TABLE. */
export interface DatabricksColumn {
	/** The column name. */
	name: string;
	/** The formatted Databricks type (e.g. `bigint`, `decimal(10,2)`, `array<string>`). */
	dataType: string;
}

/** The SQL that lists a relation's columns. `ref` is an already-quoted table reference. */
export function describeTableSql(ref: string): string {
	return `DESCRIBE TABLE ${ref}`;
}

/**
 * Parses the rows of a `DESCRIBE TABLE` result into the relation's columns, in ordinal order.
 *
 * DESCRIBE appends metadata sections after the column list for partitioned and clustered tables --
 * a blank separator row, then a `# Partition Information` header, then the partition columns
 * repeated. Everything from the first blank or `#`-prefixed row onward is that trailer, so parsing
 * stops there; otherwise the partition columns would appear twice in the tree.
 */
export function parseDescribeRows(rows: Array<Record<string, unknown>>): DatabricksColumn[] {
	const columns: DatabricksColumn[] = [];
	for (const row of rows) {
		const name = row.col_name === null || row.col_name === undefined ? '' : String(row.col_name);
		if (name.length === 0 || name.startsWith('#')) {
			break;
		}
		columns.push({
			name,
			dataType: row.data_type === null || row.data_type === undefined ? '' : String(row.data_type),
		});
	}
	return columns;
}

/**
 * The base name of a Databricks type: the leading word before any parameter list or element type,
 * lower-cased. `decimal(10,2)` -> `decimal`, `array<timestamp>` -> `array`,
 * `interval day to second` -> `interval`.
 *
 * Matching on the base name rather than searching the whole string matters for the complex types:
 * `array<timestamp>` contains "timestamp" but is not a datetime column, and a substring test would
 * classify it as one.
 */
function baseTypeName(dataType: string): string {
	return dataType.trim().toLowerCase().split(/[(<\s]/)[0];
}

/**
 * The scale of a `decimal(precision, scale)` type, or 0 when unparameterized (`decimal` alone
 * defaults to `decimal(10,0)`). Used to tell an integral decimal from a fractional one.
 */
function decimalScale(dataType: string): number {
	const match = /\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(dataType);
	return match ? Number(match[1]) : 0;
}

/**
 * Maps a Databricks type name to a Data Explorer display type. Unrecognized types fall through to
 * Unknown rather than being guessed at as strings, so the grid renders them without claiming a
 * type-specific treatment (string summary stats, text filters) that would not apply.
 */
export function databricksDisplayType(dataType: string): ColumnDisplayType {
	switch (baseTypeName(dataType)) {
		case 'boolean':
			return ColumnDisplayType.Boolean;
		case 'timestamp':
		case 'timestamp_ntz':
		case 'timestamp_ltz':
			return ColumnDisplayType.Datetime;
		case 'date':
			return ColumnDisplayType.Date;
		case 'time':
			return ColumnDisplayType.Time;
		case 'interval':
			return ColumnDisplayType.Interval;
		case 'float':
		case 'real':
		case 'double':
			return ColumnDisplayType.Floating;
		case 'decimal':
		case 'dec':
		case 'numeric':
			// A scale of 0 is an integral decimal; anything else carries a fractional part.
			return decimalScale(dataType) > 0 ? ColumnDisplayType.Decimal : ColumnDisplayType.Integer;
		case 'bigint':
		case 'long':
		case 'int':
		case 'integer':
		case 'smallint':
		case 'short':
		case 'tinyint':
		case 'byte':
			return ColumnDisplayType.Integer;
		case 'string':
		case 'varchar':
		case 'char':
			return ColumnDisplayType.String;
		case 'array':
			return ColumnDisplayType.Array;
		case 'struct':
			return ColumnDisplayType.Struct;
		// A map, a VARIANT, and a binary blob are all opaque values the grid renders as text.
		case 'map':
		case 'variant':
		case 'binary':
			return ColumnDisplayType.Object;
		default:
			return ColumnDisplayType.Unknown;
	}
}

/**
 * Reads a string field from a metadata result row, taking the first of `keys` that is present.
 *
 * Databricks' `SHOW` commands have renamed their output columns across versions (`SHOW SCHEMAS`
 * reports `databaseName` on Databricks SQL but `namespace` on open-source Spark, for example), so
 * every call passes the known aliases and browsing keeps working across warehouse and cluster
 * versions. There is deliberately no positional fallback: some of these results lead with a column
 * that is *not* the name (the metadata API's rows lead with `TABLE_CAT`), so guessing at the first
 * value would fill the tree with plausible-looking wrong names rather than visibly blank ones.
 */
export function metadataString(row: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = row[key];
		if (value !== null && value !== undefined && String(value).length > 0) {
			return String(value);
		}
	}
	return '';
}
