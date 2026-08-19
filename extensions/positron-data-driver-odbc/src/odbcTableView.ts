/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteTableView.ts (the canonical template).
// Two things differ, and both come from the backend being unknown at compile time:
//
//  - Identifier quoting and row-limiting syntax come from the OdbcDialect resolved from the ODBC
//    driver name (see odbcDatabases.ts). node-odbc exposes no SQLGetInfo, so the backend cannot be
//    interrogated at runtime; an unrecognized driver gets the SQL-92 / SQL:2008 default.
//  - Display types are derived from ODBC's own SQL type codes rather than from the backend's type
//    names. The codes are fixed by the ODBC specification, so this is the one piece of type
//    handling here that is genuinely portable.

import { OdbcDialect } from './odbcDatabases';
import { OdbcTableRef } from './odbcNodes';
import { IOdbcQueryClient } from './odbcWorkerClient';
import { OdbcRow } from './odbcWorkerProtocol';
import {
	ArraySelection,
	BackendState,
	CodeSyntaxName,
	ColumnDisplayType,
	ColumnFilterType,
	ColumnFrequencyTable,
	ColumnFrequencyTableParams,
	ColumnHistogram,
	ColumnHistogramParams,
	ColumnHistogramParamsMethod,
	ColumnProfileRequest,
	ColumnProfileResult,
	ColumnProfileType,
	ColumnSortKey,
	ColumnSummaryStats,
	ColumnValue,
	ConvertedCode,
	ConvertToCodeParams,
	DataSelectionCellIndices,
	DataSelectionCellRange,
	DataSelectionIndices,
	DataSelectionRange,
	DataSelectionSingleCell,
	ExportDataSelectionParams,
	ExportedData,
	ExportFormat,
	FilterBetween,
	FilterComparison,
	FilterComparisonOp,
	FilterMatchDataTypes,
	FilterResult,
	FilterSetMembership,
	FilterTextSearch,
	FormatOptions,
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetSchemaParams,
	ReturnColumnProfilesEvent,
	RowFilter,
	RowFilterType,
	SearchSchemaParams,
	SearchSchemaResult,
	SearchSchemaSortOrder,
	SetRowFiltersParams,
	SetSortColumnsParams,
	SupportStatus,
	TableData,
	TableSchema,
	TableSelectionKind,
	TextSearchType,
} from 'positron-data-explorer-protocol';

/** Sentinel codes for special cell values, matching the Data Explorer wire protocol. */
const SENTINEL_NULL = 0;
const SENTINEL_NAN = 2;
const SENTINEL_INF = 10;
const SENTINEL_NEGINF = 11;

/**
 * The ODBC SQL type codes, from the ODBC specification. They are the same integers for every
 * driver, which makes them a far better basis for display types than each backend's own type names.
 */
const SQL_CHAR = 1;
const SQL_NUMERIC = 2;
const SQL_DECIMAL = 3;
const SQL_INTEGER = 4;
const SQL_SMALLINT = 5;
const SQL_FLOAT = 6;
const SQL_REAL = 7;
const SQL_DOUBLE = 8;
const SQL_DATETIME = 9;
const SQL_VARCHAR = 12;
const SQL_TYPE_DATE = 91;
const SQL_TYPE_TIME = 92;
const SQL_TYPE_TIMESTAMP = 93;
const SQL_LONGVARCHAR = -1;
const SQL_BINARY = -2;
const SQL_VARBINARY = -3;
const SQL_LONGVARBINARY = -4;
const SQL_BIGINT = -5;
const SQL_TINYINT = -6;
const SQL_BIT = -7;
const SQL_WCHAR = -8;
const SQL_WVARCHAR = -9;
const SQL_WLONGVARCHAR = -10;
const SQL_GUID = -11;

/** A column in an ODBC table or view, with its backend type name and resolved display type. */
export interface OdbcSchemaEntry {
	column_name: string;
	/** The backend's own name for the type ("varchar", "NUMBER"), shown in the schema panel. */
	column_type: string;
	type_display: ColumnDisplayType;
	/**
	 * Whether the column holds raw bytes (bytea, BLOB, VARBINARY, IMAGE, ...). Tracked separately
	 * from `type_display` because that reports Object for binary columns *and* for any type code
	 * the specification does not define, and the two must not be treated alike -- see
	 * {@link OdbcTableView._columnSelector} for why binary values are never fetched.
	 */
	is_binary: boolean;
}

/** Whether an ODBC SQL type code denotes raw bytes. */
export function isBinarySqlType(dataType: number | undefined): boolean {
	return dataType === SQL_BINARY || dataType === SQL_VARBINARY || dataType === SQL_LONGVARBINARY;
}

/**
 * Maps an ODBC SQL type code to a Data Explorer display type. `typeName` is only consulted for the
 * codes that are genuinely ambiguous: SQL_BIT is the closest ODBC has to a boolean but some drivers
 * use it for a one-bit integer, and a driver that reports an unknown code still usually has a
 * recognizable type name.
 *
 * Exported for tests.
 */
export function odbcDisplayType(dataType: number | undefined, typeName: string): ColumnDisplayType {
	switch (dataType) {
		case SQL_CHAR:
		case SQL_VARCHAR:
		case SQL_LONGVARCHAR:
		case SQL_WCHAR:
		case SQL_WVARCHAR:
		case SQL_WLONGVARCHAR:
		case SQL_GUID:
			return ColumnDisplayType.String;
		case SQL_TINYINT:
		case SQL_SMALLINT:
		case SQL_INTEGER:
		case SQL_BIGINT:
			return ColumnDisplayType.Integer;
		case SQL_REAL:
		case SQL_FLOAT:
		case SQL_DOUBLE:
			return ColumnDisplayType.Floating;
		case SQL_DECIMAL:
		case SQL_NUMERIC:
			return ColumnDisplayType.Decimal;
		case SQL_BIT:
			return ColumnDisplayType.Boolean;
		case SQL_TYPE_DATE:
			return ColumnDisplayType.Date;
		case SQL_TYPE_TIME:
			return ColumnDisplayType.Time;
		case SQL_TYPE_TIMESTAMP:
		case SQL_DATETIME:
			return ColumnDisplayType.Datetime;
		case SQL_BINARY:
		case SQL_VARBINARY:
		case SQL_LONGVARBINARY:
			return ColumnDisplayType.Object;
		default:
			break;
	}

	// An unrecognized code (a driver's own extension type). Fall back to the type name, which is
	// usually descriptive even when the code is not.
	const name = typeName.toUpperCase();
	if (name.includes('BOOL')) { return ColumnDisplayType.Boolean; }
	if (name.includes('TIMESTAMP') || name.includes('DATETIME')) { return ColumnDisplayType.Datetime; }
	if (name.includes('DATE')) { return ColumnDisplayType.Date; }
	if (name.includes('TIME')) { return ColumnDisplayType.Time; }
	if (name.includes('INT')) { return ColumnDisplayType.Integer; }
	if (name.includes('CHAR') || name.includes('TEXT') || name.includes('STRING')) { return ColumnDisplayType.String; }
	if (name.includes('DEC') || name.includes('NUMER')) { return ColumnDisplayType.Decimal; }
	if (name.includes('FLOAT') || name.includes('DOUBLE') || name.includes('REAL')) { return ColumnDisplayType.Floating; }
	return ColumnDisplayType.Object;
}

/** Escapes a value for use inside a single-quoted SQL string literal. */
function quoteLiteral(value: string): string {
	return value.replace(/'/g, '\'\'');
}

const COMPARISON_OPS = new Map<FilterComparisonOp, string>([
	[FilterComparisonOp.Eq, '='],
	[FilterComparisonOp.NotEq, '<>'],
	[FilterComparisonOp.Gt, '>'],
	[FilterComparisonOp.GtEq, '>='],
	[FilterComparisonOp.Lt, '<'],
	[FilterComparisonOp.LtEq, '<=']
]);

/**
 * Serves Data Explorer requests for a single table or view reached over ODBC. Translates each
 * protocol method into SQL run through the connection's worker client, in the dialect resolved for
 * the backend.
 */
export class OdbcTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];

	private _whereClause: string = '';
	private _sortClause: string = '';

	private _unfilteredRows: Promise<number>;
	private _filteredRows: Promise<number>;

	/**
	 * Whether the backend accepted the ODBC `{fn OCTET_LENGTH(...)}` escape for measuring a binary
	 * column. Set false the first time a read of a binary column fails, after which those columns
	 * report only whether a value is present. See {@link _columnSelector}.
	 */
	private _binaryLengthSupported = true;

	/**
	 * @param client The query client for the owning connection.
	 * @param ref The table or view this view serves.
	 * @param dialect How to write SQL for this backend.
	 * @param schema The resolved column schema.
	 */
	constructor(
		private readonly client: IOdbcQueryClient,
		private readonly ref: OdbcTableRef,
		private readonly dialect: OdbcDialect,
		private readonly schema: Array<OdbcSchemaEntry>,
	) {
		this._sortClause = this._buildSortClause([], true);
		this._unfilteredRows = this._countRows('');
		this._filteredRows = this._unfilteredRows;
	}

	/**
	 * Builds the SELECT expression for a column, aliased so duplicate names stay unambiguous.
	 *
	 * Binary columns are never fetched as bytes. node-odbc materializes them with
	 * `napi_create_external_arraybuffer`, which Electron refuses -- V8's memory cage forbids
	 * external array buffers -- and the refusal is a fatal native error that kills the worker rather
	 * than an exception anything can catch. It is only fatal in the desktop extension host; the
	 * server one is real Node and unaffected. Rather than have the Data Explorer work on Workbench
	 * and crash on Desktop, no binary value is ever requested.
	 *
	 * Nothing is lost by it: a binary cell renders as `[BINARY n bytes]`, so the bytes were only
	 * ever fetched to be measured and discarded. `{fn OCTET_LENGTH(...)}` is ODBC's portable escape
	 * for that measurement, and where a driver rejects it the fallback asks only whether the value
	 * is null, which is plain SQL every backend accepts.
	 */
	private _columnSelector(entry: OdbcSchemaEntry, alias: string): string {
		const quoted = this._quote(entry.column_name);
		if (!entry.is_binary) {
			return `${quoted} AS ${alias}`;
		}
		return this._binaryLengthSupported
			? `{fn OCTET_LENGTH(${quoted})} AS ${alias}`
			// 0 for null, 1 for present -- enough to tell an absent value from a binary one without
			// naming a type or a function.
			: `CASE WHEN ${quoted} IS NULL THEN 0 ELSE 1 END AS ${alias}`;
	}

	/**
	 * Stringifies a cell for export. Binary columns carry a measurement rather than their bytes
	 * (see {@link _columnSelector}), so they are rendered from that rather than from content.
	 */
	private _stringifyExportCell(value: unknown, entry: OdbcSchemaEntry): string {
		if (!entry.is_binary) {
			return stringifyExportCell(value);
		}
		if (value === null || value === undefined) {
			return 'NULL';
		}
		const measure = Number(value);
		if (!this._binaryLengthSupported) {
			return measure === 0 ? 'NULL' : '[BINARY]';
		}
		return Number.isFinite(measure) ? `[BINARY ${measure} bytes]` : '[BINARY]';
	}

	/** Whether any of the given columns is binary, i.e. whether a read of them can be retried. */
	private _hasBinary(columns: readonly OdbcSchemaEntry[]): boolean {
		return columns.some(column => column.is_binary);
	}

	/**
	 * Runs a read, retrying once without the `{fn OCTET_LENGTH(...)}` escape if the backend rejected
	 * it. Only the first failure costs a round trip: the fallback is remembered for the view's life.
	 * @param columns The columns the query selects, used to decide whether a retry could help.
	 * @param buildQuery Builds the SQL, called again after the fallback is engaged.
	 */
	private async _readWithBinaryFallback(
		columns: readonly OdbcSchemaEntry[],
		buildQuery: () => string
	): Promise<OdbcRow[]> {
		try {
			return await this.client.runQuery(buildQuery());
		} catch (error) {
			if (!this._binaryLengthSupported || !this._hasBinary(columns)) {
				throw error;
			}
			this._binaryLengthSupported = false;
			return this.client.runQuery(buildQuery());
		}
	}

	/** Quotes and escapes an identifier, doubling the dialect's quote character where embedded. */
	private _quote(name: string): string {
		const quote = this.dialect.identifierQuote;
		return quote + name.split(quote).join(quote + quote) + quote;
	}

	/** The fully qualified, quoted table reference for use in FROM clauses. */
	private get _quotedTable(): string {
		return [this.ref.catalog, this.ref.schema, this.ref.name]
			.filter((part): part is string => part !== undefined && part.length > 0)
			.map(part => this._quote(part))
			.join('.');
	}

	/**
	 * Renders a windowed read in the backend's dialect.
	 *
	 * `OFFSET ... FETCH NEXT` (the SQL:2008 form) requires an ORDER BY on SQL Server, and paging
	 * without one is not reproducible on any backend -- two requests for consecutive pages can
	 * return overlapping or missing rows. The sort clause always carries an ordering for that
	 * reason; see _buildSortClause.
	 */
	private _paginate(limit: number, offset: number): string {
		return this.dialect.pagination === 'limit-offset'
			? ` LIMIT ${limit} OFFSET ${offset}`
			: ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
	}

	private async _countRows(whereClause: string): Promise<number> {
		const rows = await this.client.runQuery(`SELECT count(*) AS n FROM ${this._quotedTable}${whereClause}`);
		return Number(firstValue(rows[0], 'n') ?? 0);
	}

	/**
	 * Builds a SQL WHERE expression for a single row filter.
	 *
	 * Regex is the one filter with no portable spelling: the operator is `~` on PostgreSQL,
	 * `REGEXP` on MySQL, `RLIKE` on the Hive family, and simply absent on SQL Server. Rather than
	 * approximate it with LIKE -- which would silently return the wrong rows -- an explicit error is
	 * raised, and the Data Explorer surfaces it.
	 */
	private _makeWhereExpr(rowFilter: RowFilter): string {
		const schema = rowFilter.column_schema;
		const quotedName = this._quote(schema.column_name);
		const formatLiteral = (value: string): string =>
			schema.type_display === ColumnDisplayType.String ? `'${quoteLiteral(value)}'` : value;

		switch (rowFilter.filter_type) {
			case RowFilterType.Compare: {
				const params = rowFilter.params as FilterComparison;
				const op: string = COMPARISON_OPS.get(params.op) ?? params.op;
				return `${quotedName} ${op} ${formatLiteral(params.value)}`;
			}
			case RowFilterType.NotBetween:
			case RowFilterType.Between: {
				const params = rowFilter.params as FilterBetween;
				const expr = `${quotedName} BETWEEN ${formatLiteral(params.left_value)} AND ${formatLiteral(params.right_value)}`;
				return rowFilter.filter_type === RowFilterType.NotBetween ? `(NOT (${expr}))` : expr;
			}
			case RowFilterType.IsEmpty:
				return `${quotedName} = ''`;
			case RowFilterType.NotEmpty:
				return `${quotedName} <> ''`;
			case RowFilterType.IsFalse:
				// ODBC reports booleans as SQL_BIT, and every backend that has one accepts 0/1.
				return `${quotedName} = 0`;
			case RowFilterType.IsTrue:
				return `${quotedName} <> 0`;
			case RowFilterType.IsNull:
				return `${quotedName} IS NULL`;
			case RowFilterType.NotNull:
				return `${quotedName} IS NOT NULL`;
			case RowFilterType.Search: {
				const params = rowFilter.params as FilterTextSearch;
				// LOWER is in every SQL dialect; a case-insensitive LIKE is not.
				const searchArg = params.case_sensitive ? quotedName : `LOWER(${quotedName})`;
				const term = quoteLiteral(params.case_sensitive ? params.term : params.term.toLowerCase());
				const pattern = escapeLikePattern(term);
				switch (params.search_type) {
					case TextSearchType.Contains:
						return `${searchArg} LIKE '%${pattern}%' ${LIKE_ESCAPE_CLAUSE}`;
					case TextSearchType.NotContains:
						return `${searchArg} NOT LIKE '%${pattern}%' ${LIKE_ESCAPE_CLAUSE}`;
					case TextSearchType.StartsWith:
						return `${searchArg} LIKE '${pattern}%' ${LIKE_ESCAPE_CLAUSE}`;
					case TextSearchType.EndsWith:
						return `${searchArg} LIKE '%${pattern}' ${LIKE_ESCAPE_CLAUSE}`;
					case TextSearchType.RegexMatch:
						throw new Error('Regular expression filters are not available over ODBC, because ODBC backends have no common regular expression syntax.');
				}
				return '1=1';
			}
			case RowFilterType.SetMembership: {
				const params = rowFilter.params as FilterSetMembership;
				const op = params.inclusive ? 'IN' : 'NOT IN';
				return `${quotedName} ${op} (${params.values.map(formatLiteral).join(', ')})`;
			}
		}
		return '1=1';
	}

	async getSchema(params: GetSchemaParams): Promise<TableSchema> {
		return {
			columns: params.column_indices.map(index => {
				const entry = this.schema[index];
				return {
					column_name: entry.column_name,
					column_index: index,
					type_name: entry.column_type,
					type_display: entry.type_display,
				};
			}),
		};
	}

	async searchSchema(params: SearchSchemaParams): Promise<SearchSchemaResult> {
		let indices = this.schema.map((_, i) => i);

		if (params.filters && params.filters.length > 0) {
			indices = indices.filter(index => {
				const entry = this.schema[index];
				return params.filters.every(filter => {
					switch (filter.filter_type) {
						case ColumnFilterType.TextSearch: {
							const tf = filter.params as FilterTextSearch;
							const term = tf.case_sensitive ? tf.term : tf.term.toLowerCase();
							const name = tf.case_sensitive ? entry.column_name : entry.column_name.toLowerCase();
							switch (tf.search_type) {
								case TextSearchType.Contains: return name.includes(term);
								case TextSearchType.NotContains: return !name.includes(term);
								case TextSearchType.StartsWith: return name.startsWith(term);
								case TextSearchType.EndsWith: return name.endsWith(term);
								case TextSearchType.RegexMatch:
									// Schema search runs in TypeScript, not SQL, so regex is fine here
									// even though it is unavailable as a row filter.
									try {
										return new RegExp(tf.term, tf.case_sensitive ? '' : 'i').test(entry.column_name);
									} catch {
										return false;
									}
								default: return false;
							}
						}
						case ColumnFilterType.MatchDataTypes: {
							const df = filter.params as FilterMatchDataTypes;
							return df.display_types.includes(entry.type_display);
						}
						default: return false;
					}
				});
			});
		}

		const byName = (a: number, b: number) =>
			this.schema[a].column_name.toLowerCase().localeCompare(this.schema[b].column_name.toLowerCase());
		const byType = (a: number, b: number) =>
			this.schema[a].column_type.toLowerCase().localeCompare(this.schema[b].column_type.toLowerCase());
		switch (params.sort_order) {
			case SearchSchemaSortOrder.AscendingName: indices.sort(byName); break;
			case SearchSchemaSortOrder.DescendingName: indices.sort((a, b) => byName(b, a)); break;
			case SearchSchemaSortOrder.AscendingType: indices.sort(byType); break;
			case SearchSchemaSortOrder.DescendingType: indices.sort((a, b) => byType(b, a)); break;
			default: break;
		}

		return { matches: indices };
	}

	async getDataValues(params: GetDataValuesParams): Promise<TableData> {
		const filteredRows = await this._filteredRows;
		if (filteredRows === 0 || params.columns.length === 0) {
			return { columns: Array.from({ length: params.columns.length }, () => []) };
		}

		// Find the overall row range covering every requested column selection.
		let lowerLimit = Infinity;
		let upperLimit = -Infinity;
		for (const column of params.columns) {
			if (isSelectionRange(column.spec)) {
				lowerLimit = Math.min(lowerLimit, column.spec.first_index);
				upperLimit = Math.max(upperLimit, column.spec.last_index);
			} else {
				lowerLimit = Math.min(lowerLimit, ...column.spec.indices);
				upperLimit = Math.max(upperLimit, ...column.spec.indices);
			}
		}
		if (!isFinite(lowerLimit) || !isFinite(upperLimit)) {
			return { columns: Array.from({ length: params.columns.length }, () => []) };
		}
		const numRows = upperLimit - lowerLimit + 1;

		// Select each requested column under a positional alias so duplicates are unambiguous.
		const selected = params.columns.map(column => this.schema[column.column_index]);
		const rows = await this._readWithBinaryFallback(selected, () =>
			`SELECT ${selected.map((entry, i) => this._columnSelector(entry, `c${i}`)).join(', ')} ` +
			`FROM ${this._quotedTable}` +
			`${this._whereClause}${this._sortClause}${this._paginate(numRows, lowerLimit)}`);

		const result: TableData = { columns: [] };
		for (let i = 0; i < params.columns.length; i++) {
			const column = params.columns[i];
			const entry = this.schema[column.column_index];
			const format = (absIndex: number): ColumnValue => {
				const row = rows[absIndex - lowerLimit];
				return row === undefined
					? SENTINEL_NULL
					: this._formatValue(firstValue(row, `c${i}`), entry, params.format_options);
			};

			const spec = column.spec;
			if (isSelectionRange(spec)) {
				const lastIndex = Math.min(spec.last_index, lowerLimit + rows.length - 1);
				const values: ColumnValue[] = [];
				for (let r = spec.first_index; r <= lastIndex; r++) {
					values.push(format(r));
				}
				result.columns.push(values);
			} else {
				result.columns.push(spec.indices.map(format));
			}
		}
		return result;
	}

	/**
	 * Formats a raw ODBC value into the Data Explorer cell encoding: a sentinel number for
	 * null/NaN/+-Inf, otherwise a formatted string.
	 */
	private _formatValue(value: unknown, entry: OdbcSchemaEntry, opts: FormatOptions): ColumnValue {
		if (value === null || value === undefined) {
			return SENTINEL_NULL;
		}

		// A binary column never carries its bytes here (see _columnSelector): the value is the byte
		// count, or -- once the length escape has been rejected by this backend -- 0 for null and 1
		// for present.
		if (entry.is_binary) {
			const measure = Number(value);
			if (!this._binaryLengthSupported) {
				return measure === 0 ? SENTINEL_NULL : '[BINARY]';
			}
			return Number.isFinite(measure) ? `[BINARY ${measure} bytes]` : '[BINARY]';
		}

		switch (entry.type_display) {
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Decimal: {
				const num = typeof value === 'number' ? value : Number(value);
				if (Number.isNaN(num)) { return SENTINEL_NAN; }
				if (num === Infinity) { return SENTINEL_INF; }
				if (num === -Infinity) { return SENTINEL_NEGINF; }
				return formatFloat(num, opts);
			}
			case ColumnDisplayType.Integer: {
				const num = typeof value === 'bigint' ? value : Number(value);
				return formatInteger(num, opts);
			}
			case ColumnDisplayType.Boolean:
				// Drivers differ: some map SQL_BIT to a JavaScript boolean, others to 0/1.
				if (typeof value === 'boolean') { return value ? 'true' : 'false'; }
				if (typeof value === 'number') { return value ? 'true' : 'false'; }
				return truncate(String(value), opts);
			case ColumnDisplayType.Object:
				if (value instanceof Uint8Array) {
					return `[BINARY ${value.byteLength} bytes]`;
				}
				return truncate(String(value), opts);
			default:
				return truncate(String(value), opts);
		}
	}

	async setRowFilters(params: SetRowFiltersParams): Promise<FilterResult> {
		this.rowFilters = params.filters;
		if (this.rowFilters.length === 0) {
			this._whereClause = '';
			this._filteredRows = this._unfilteredRows;
		} else {
			this._whereClause = `\nWHERE ${this.rowFilters.map(filter => this._makeWhereExpr(filter)).join(' AND ')}`;
			this._filteredRows = this._countRows(this._whereClause);
		}
		return { selected_num_rows: await this._filteredRows };
	}

	async setSortColumns(params: SetSortColumnsParams): Promise<void> {
		this.sortKeys = params.sort_keys;
		this._sortClause = this._buildSortClause(this.sortKeys, true);
	}

	/**
	 * Builds an ORDER BY clause for the given sort keys.
	 *
	 * Unlike SQLite's `rowid`, ODBC exposes no portable row identity to use as a tiebreaker, so the
	 * table's first column stands in: appended after the user's sort keys it makes paging
	 * reproducible, and on its own it gives an unsorted view a deterministic order. Rows that tie
	 * on that column can still swap between pages, but the alternative -- no ordering at all -- lets
	 * the backend return a different arrangement for every page, and is invalid outright for the
	 * `OFFSET ... FETCH` dialects.
	 */
	private _buildSortClause(sortKeys: Array<ColumnSortKey>, includeTiebreaker: boolean): string {
		const exprs = sortKeys.map(key =>
			`${this._quote(this.schema[key.column_index].column_name)}${key.ascending ? '' : ' DESC'}`);

		if (includeTiebreaker && this.schema.length > 0) {
			const tiebreaker = this._quote(this.schema[0].column_name);
			if (!exprs.some(expr => expr.startsWith(tiebreaker))) {
				exprs.push(tiebreaker);
			}
		}

		return exprs.length > 0 ? `\nORDER BY ${exprs.join(', ')}` : '';
	}

	async getState(): Promise<BackendState> {
		const [unfilteredRows, filteredRows] = await Promise.all([this._unfilteredRows, this._filteredRows]);
		const numColumns = this.schema.length;
		return {
			display_name: this.ref.name,
			table_shape: { num_rows: filteredRows, num_columns: numColumns },
			table_unfiltered_shape: { num_rows: unfilteredRows, num_columns: numColumns },
			has_row_labels: false,
			column_filters: [],
			row_filters: this.rowFilters,
			sort_keys: this.sortKeys,
			supported_features: {
				get_column_profiles: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{ profile_type: ColumnProfileType.NullCount, support_status: SupportStatus.Supported },
						{ profile_type: ColumnProfileType.SummaryStats, support_status: SupportStatus.Supported },
						{ profile_type: ColumnProfileType.SmallFrequencyTable, support_status: SupportStatus.Supported },
						{ profile_type: ColumnProfileType.LargeFrequencyTable, support_status: SupportStatus.Supported },
						{ profile_type: ColumnProfileType.SmallHistogram, support_status: SupportStatus.Supported },
						{ profile_type: ColumnProfileType.LargeHistogram, support_status: SupportStatus.Supported },
					],
				},
				search_schema: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{ column_filter_type: ColumnFilterType.TextSearch, support_status: SupportStatus.Supported },
						{ column_filter_type: ColumnFilterType.MatchDataTypes, support_status: SupportStatus.Supported },
					],
				},
				set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
				set_row_filters: {
					support_status: SupportStatus.Supported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: [
						{ row_filter_type: RowFilterType.Between, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.Compare, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.IsEmpty, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.IsFalse, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.IsNull, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.IsTrue, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.NotBetween, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.NotEmpty, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.NotNull, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.Search, support_status: SupportStatus.Supported },
						{ row_filter_type: RowFilterType.SetMembership, support_status: SupportStatus.Supported },
					],
				},
				set_sort_columns: { support_status: SupportStatus.Supported },
				export_data_selection: {
					support_status: SupportStatus.Supported,
					supported_formats: [ExportFormat.Csv, ExportFormat.Tsv, ExportFormat.Html],
				},
				convert_to_code: {
					support_status: SupportStatus.Supported,
					code_syntaxes: [{ code_syntax_name: 'SQL' }],
				},
			},
		};
	}

	async convertToCode(_params: ConvertToCodeParams): Promise<ConvertedCode> {
		const result = ['SELECT *', `FROM ${this._quotedTable}`];
		if (this._whereClause) {
			result.push(this._whereClause.replace(/\n/g, ' ').trim());
		}
		// The generated SQL is for the user to run themselves, so it carries only the ordering they
		// actually chose -- the tiebreaker exists to make Positron's own paging reproducible and
		// would just be noise here.
		const sortClause = this._buildSortClause(this.sortKeys, false).replace(/\n/g, ' ').trim();
		if (sortClause) {
			result.push(sortClause);
		}
		return { converted_code: result };
	}

	async suggestCodeSyntax(): Promise<CodeSyntaxName> {
		return { code_syntax_name: 'SQL' };
	}

	async exportDataSelection(params: ExportDataSelectionParams): Promise<ExportedData> {
		const kind = params.selection.kind;
		const order = this._sortClause;

		// The query is built lazily so it can be rebuilt if the backend rejects the binary-length
		// escape; see _readWithBinaryFallback.
		const runExport = async (buildQuery: () => string, columns: Array<OdbcSchemaEntry>): Promise<ExportedData> => {
			const rows = await this._readWithBinaryFallback(columns, buildQuery);
			const matrix = [
				columns.map(c => c.column_name),
				...rows.map(row => columns.map((entry, i) => this._stringifyExportCell(firstValue(row, `c${i}`), entry))),
			];
			return { data: formatExport(matrix, params.format), format: params.format };
		};

		const selectorsFor = (columns: Array<OdbcSchemaEntry>) =>
			columns.map((c, i) => this._columnSelector(c, `c${i}`)).join(', ');

		switch (kind) {
			case TableSelectionKind.SingleCell: {
				const sel = params.selection.selection as DataSelectionSingleCell;
				const column = this.schema[sel.column_index];
				const rows = await this._readWithBinaryFallback([column], () =>
					`SELECT ${this._columnSelector(column, 'c0')} FROM ${this._quotedTable}` +
					`${this._whereClause}${order}${this._paginate(1, sel.row_index)}`);
				return { data: this._stringifyExportCell(firstValue(rows[0], 'c0'), column), format: params.format };
			}
			case TableSelectionKind.CellRange: {
				const sel = params.selection.selection as DataSelectionCellRange;
				const columns = this.schema.slice(sel.first_column_index, sel.last_column_index + 1);
				return runExport(() => `SELECT ${selectorsFor(columns)} FROM ${this._quotedTable}` +
					`${this._whereClause}${order}${this._paginate(sel.last_row_index - sel.first_row_index + 1, sel.first_row_index)}`, columns);
			}
			case TableSelectionKind.RowRange: {
				const sel = params.selection.selection as DataSelectionRange;
				return runExport(() => `SELECT ${selectorsFor(this.schema)} FROM ${this._quotedTable}` +
					`${this._whereClause}${order}${this._paginate(sel.last_index - sel.first_index + 1, sel.first_index)}`, this.schema);
			}
			case TableSelectionKind.ColumnRange: {
				const sel = params.selection.selection as DataSelectionRange;
				const columns = this.schema.slice(sel.first_index, sel.last_index + 1);
				return runExport(() => `SELECT ${selectorsFor(columns)} FROM ${this._quotedTable}${this._whereClause}${order}`, columns);
			}
			case TableSelectionKind.ColumnIndices: {
				const sel = params.selection.selection as DataSelectionIndices;
				const columns = sel.indices.map(i => this.schema[i]);
				return runExport(() => `SELECT ${selectorsFor(columns)} FROM ${this._quotedTable}${this._whereClause}${order}`, columns);
			}
			case TableSelectionKind.RowIndices: {
				const sel = params.selection.selection as DataSelectionIndices;
				return runExport(() => this._rowIndexQuery(selectorsFor(this.schema), sel.indices), this.schema);
			}
			case TableSelectionKind.CellIndices: {
				const sel = params.selection.selection as DataSelectionCellIndices;
				const columns = sel.column_indices.map(i => this.schema[i]);
				return runExport(() => this._rowIndexQuery(selectorsFor(columns), sel.row_indices), columns);
			}
		}
	}

	/**
	 * Builds a query that selects specific (post-sort, post-filter) row positions in the requested
	 * order, using a ROW_NUMBER() window. Window functions are in SQL:2003 and supported by every
	 * backend Positron is likely to reach over ODBC; older ones will report a syntax error, which is
	 * the honest outcome for a selection that cannot be expressed.
	 */
	private _rowIndexQuery(selectors: string, rowIndices: number[]): string {
		const ordering = this._sortClause.replace(/^\n/, '');
		const numbered = `SELECT *, ROW_NUMBER() OVER (${ordering}) - 1 AS __row_index ` +
			`FROM ${this._quotedTable}${this._whereClause}`;
		const order = rowIndices.map((rowIdx, i) => `WHEN ${rowIdx} THEN ${i}`).join(' ');
		const inList = rowIndices.join(', ');
		// The derived table is aliased: SQL Server and Oracle both require a name for a subquery in
		// FROM, where SQLite does not.
		return `SELECT ${selectors} FROM (${numbered}) AS __numbered WHERE __row_index IN (${inList}) ` +
			`ORDER BY CASE __row_index ${order} END`;
	}

	/**
	 * Computes the requested column profiles. Returns the event payload to send to the frontend;
	 * the caller is responsible for delivering it (so this class stays free of vscode APIs).
	 */
	async computeColumnProfiles(params: GetColumnProfilesParams): Promise<ReturnColumnProfilesEvent> {
		const filteredRows = await this._filteredRows;
		const profiles: ColumnProfileResult[] = [];
		for (const request of params.profiles) {
			profiles.push(await this._computeOneColumnProfile(request, filteredRows, params.format_options));
		}
		return { callback_id: params.callback_id, profiles };
	}

	private async _computeOneColumnProfile(
		request: ColumnProfileRequest,
		filteredRows: number,
		formatOptions: FormatOptions,
	): Promise<ColumnProfileResult> {
		const entry = this.schema[request.column_index];
		const quotedName = this._quote(entry.column_name);
		const result: ColumnProfileResult = {};

		for (const spec of request.profiles) {
			switch (spec.profile_type) {
				case ColumnProfileType.NullCount:
					result.null_count = await this._nullCount(quotedName);
					break;
				case ColumnProfileType.SummaryStats:
					result.summary_stats = filteredRows === 0
						? this._emptySummaryStats(entry)
						: await this._summaryStats(entry, quotedName, formatOptions);
					break;
				case ColumnProfileType.SmallFrequencyTable:
				case ColumnProfileType.LargeFrequencyTable:
					// A frequency table over a binary column would have to select the bytes as the
					// group key, which is the read that kills the worker (see _columnSelector) --
					// and "the most common blob" is not a question worth answering anyway.
					result[spec.profile_type] = entry.is_binary
						? { values: [], counts: [], other_count: filteredRows }
						: await this._frequencyTable(
							quotedName, (spec.params as ColumnFrequencyTableParams).limit, filteredRows);
					break;
				case ColumnProfileType.SmallHistogram:
				case ColumnProfileType.LargeHistogram:
					result[spec.profile_type] = await this._histogram(
						entry, quotedName, spec.params as ColumnHistogramParams, filteredRows);
					break;
				default:
					break;
			}
		}
		return result;
	}

	private async _nullCount(quotedName: string): Promise<number> {
		const rows = await this.client.runQuery(
			`SELECT count(*) - count(${quotedName}) AS n FROM ${this._quotedTable}${this._whereClause}`);
		return Number(firstValue(rows[0], 'n') ?? 0);
	}

	private _wherePlus(predicate: string): string {
		return this._whereClause ? `${this._whereClause} AND ${predicate}` : `\nWHERE ${predicate}`;
	}

	private async _summaryStats(
		entry: OdbcSchemaEntry,
		quotedName: string,
		formatOptions: FormatOptions,
	): Promise<ColumnSummaryStats> {
		const display = entry.type_display;
		if (display === ColumnDisplayType.Integer || display === ColumnDisplayType.Floating || display === ColumnDisplayType.Decimal) {
			// One pass for the moment-based stats; a second query for the median. Multiplying by
			// 1.0 forces floating-point accumulation on backends where SUM over an integer column
			// stays integral and would overflow.
			const rows = await this.client.runQuery(
				`SELECT count(${quotedName}) AS n, min(${quotedName}) AS lo, max(${quotedName}) AS hi, ` +
				`sum(${quotedName} * 1.0) AS s, sum(${quotedName} * 1.0 * ${quotedName}) AS ss ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
			const row = rows[0];
			const n = Number(firstValue(row, 'n') ?? 0);
			const sum = Number(firstValue(row, 's') ?? 0);
			const sumsq = Number(firstValue(row, 'ss') ?? 0);
			const mean = n > 0 ? sum / n : 0;
			// Sample standard deviation from the sums of values and squares.
			const variance = n > 1 ? Math.max(0, (sumsq - n * mean * mean) / (n - 1)) : 0;
			const median = await this._quantile(quotedName, 0.5, n);
			const fmt = (v: number) => formatFloat(v, formatOptions);
			const lo = firstValue(row, 'lo');
			const hi = firstValue(row, 'hi');
			return {
				type_display: display,
				number_stats: {
					min_value: lo === null || lo === undefined ? undefined : String(lo),
					max_value: hi === null || hi === undefined ? undefined : String(hi),
					mean: n > 0 ? fmt(mean) : undefined,
					median: median === undefined ? undefined : fmt(median),
					stdev: n > 1 ? fmt(Math.sqrt(variance)) : undefined,
				},
			};
		}
		if (display === ColumnDisplayType.String) {
			const rows = await this.client.runQuery(
				`SELECT count(DISTINCT ${quotedName}) AS nunique, ` +
				`count(CASE WHEN ${quotedName} = '' THEN 1 END) AS nempty ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
			return {
				type_display: ColumnDisplayType.String,
				string_stats: {
					num_unique: Number(firstValue(rows[0], 'nunique') ?? 0),
					num_empty: Number(firstValue(rows[0], 'nempty') ?? 0),
				},
			};
		}
		if (display === ColumnDisplayType.Boolean) {
			const rows = await this.client.runQuery(
				`SELECT count(CASE WHEN ${quotedName} <> 0 THEN 1 END) AS ntrue, ` +
				`count(CASE WHEN ${quotedName} = 0 THEN 1 END) AS nfalse ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: {
					true_count: Number(firstValue(rows[0], 'ntrue') ?? 0),
					false_count: Number(firstValue(rows[0], 'nfalse') ?? 0),
				},
			};
		}
		if (display === ColumnDisplayType.Date || display === ColumnDisplayType.Datetime) {
			const rows = await this.client.runQuery(
				`SELECT min(${quotedName}) AS lo, max(${quotedName}) AS hi, count(DISTINCT ${quotedName}) AS nunique ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
			const lo = firstValue(rows[0], 'lo');
			const hi = firstValue(rows[0], 'hi');
			const stats = {
				num_unique: Number(firstValue(rows[0], 'nunique') ?? 0),
				min_date: lo === null || lo === undefined ? undefined : String(lo),
				max_date: hi === null || hi === undefined ? undefined : String(hi),
			};
			return display === ColumnDisplayType.Date
				? { type_display: display, date_stats: stats }
				: { type_display: display, datetime_stats: stats };
		}
		const rows = await this.client.runQuery(
			`SELECT count(DISTINCT ${quotedName}) AS nunique FROM ${this._quotedTable}${this._whereClause}`);
		return { type_display: display, other_stats: { num_unique: Number(firstValue(rows[0], 'nunique') ?? 0) } };
	}

	private _emptySummaryStats(entry: OdbcSchemaEntry): ColumnSummaryStats {
		switch (entry.type_display) {
			case ColumnDisplayType.Integer:
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Decimal:
				return { type_display: entry.type_display, number_stats: {} };
			case ColumnDisplayType.String:
				return { type_display: ColumnDisplayType.String, string_stats: { num_unique: 0, num_empty: 0 } };
			case ColumnDisplayType.Boolean:
				return { type_display: ColumnDisplayType.Boolean, boolean_stats: { true_count: 0, false_count: 0 } };
			case ColumnDisplayType.Date:
				return { type_display: ColumnDisplayType.Date, date_stats: { num_unique: 0 } };
			case ColumnDisplayType.Datetime:
				return { type_display: ColumnDisplayType.Datetime, datetime_stats: { num_unique: 0 } };
			default:
				return { type_display: entry.type_display, other_stats: { num_unique: 0 } };
		}
	}

	/**
	 * Computes a quantile (0..1) by ordering the non-null values and reading the value at the
	 * corresponding offset. `n` is the count of non-null values.
	 */
	private async _quantile(quotedName: string, q: number, n: number): Promise<number | undefined> {
		if (n === 0) {
			return undefined;
		}
		const offset = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
		const rows = await this.client.runQuery(
			`SELECT ${quotedName} AS v FROM ${this._quotedTable}${this._wherePlus(`${quotedName} IS NOT NULL`)} ` +
			`ORDER BY ${quotedName}${this._paginate(1, offset)}`);
		const value = firstValue(rows[0], 'v');
		return value === null || value === undefined ? undefined : Number(value);
	}

	private async _frequencyTable(quotedName: string, limit: number, filteredRows: number): Promise<ColumnFrequencyTable> {
		// count(*) is aliased and then ordered by the alias; ordering by the aggregate expression
		// itself is what SQL Server requires, and repeating it satisfies both.
		const rows = await this.client.runQuery(
			`SELECT ${quotedName} AS value, count(*) AS freq FROM ${this._quotedTable}` +
			`${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY ${quotedName} ` +
			`ORDER BY count(*) DESC, ${quotedName} ASC${this._paginate(limit, 0)}`);
		const values: ColumnValue[] = [];
		const counts: number[] = [];
		let total = 0;
		for (const row of rows) {
			values.push(String(firstValue(row, 'value')));
			const freq = Number(firstValue(row, 'freq'));
			counts.push(freq);
			total += freq;
		}
		const nullCount = await this._nullCount(quotedName);
		return { values, counts, other_count: Math.max(0, filteredRows - total - nullCount) };
	}

	private async _histogram(
		entry: OdbcSchemaEntry,
		quotedName: string,
		params: ColumnHistogramParams,
		filteredRows: number,
	): Promise<ColumnHistogram> {
		const nullCount = await this._nullCount(quotedName);
		const nonNull = filteredRows - nullCount;
		if (nonNull <= 0) {
			return { bin_edges: ['NULL', 'NULL'], bin_counts: [nullCount], quantiles: [] };
		}

		const rows = await this.client.runQuery(
			`SELECT min(${quotedName}) AS lo, max(${quotedName}) AS hi FROM ${this._quotedTable}${this._whereClause}`);
		const minValue = Number(firstValue(rows[0], 'lo'));
		const maxValue = Number(firstValue(rows[0], 'hi'));
		const peakToPeak = maxValue - minValue;

		// A degenerate range (single distinct value) collapses to one bin.
		if (!isFinite(peakToPeak) || peakToPeak === 0) {
			return { bin_edges: [String(minValue), String(maxValue)], bin_counts: [nonNull], quantiles: [] };
		}

		let binWidth = 0;
		switch (params.method) {
			case ColumnHistogramParamsMethod.Fixed:
				binWidth = peakToPeak / params.num_bins;
				break;
			case ColumnHistogramParamsMethod.FreedmanDiaconis: {
				const q1 = await this._quantile(quotedName, 0.25, nonNull);
				const q3 = await this._quantile(quotedName, 0.75, nonNull);
				const iqr = (q3 ?? 0) - (q1 ?? 0);
				if (iqr > 0) {
					binWidth = 2 * iqr * Math.pow(nonNull, -1 / 3);
				}
				break;
			}
			case ColumnHistogramParamsMethod.Sturges:
			case ColumnHistogramParamsMethod.Scott:
			default:
				binWidth = peakToPeak / (Math.log2(nonNull) + 1);
				break;
		}
		if (binWidth <= 0) {
			binWidth = peakToPeak / params.num_bins;
		}

		let numBins = Math.ceil(peakToPeak / binWidth);
		if (numBins > params.num_bins) {
			numBins = params.num_bins;
			binWidth = peakToPeak / numBins;
		}
		if (entry.type_display === ColumnDisplayType.Integer && peakToPeak <= numBins) {
			numBins = peakToPeak + 1;
			binWidth = peakToPeak / numBins;
		}

		// FLOOR is standard SQL and available everywhere, unlike a CAST to an integer type whose
		// name differs per backend (INTEGER, INT, SIGNED). Values are >= minValue, so the bin id is
		// non-negative and FLOOR and truncation agree. The expression is repeated in GROUP BY
		// rather than referenced by alias, which SQL Server does not allow there.
		const binExpr = `FLOOR((${quotedName} * 1.0 - ${minValue}) / ${binWidth})`;
		const binRows = await this.client.runQuery(
			`SELECT ${binExpr} AS bin_id, count(*) AS bin_count ` +
			`FROM ${this._quotedTable}${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY ${binExpr}`);
		const histEntries = new Map<number, number>(
			binRows.map(row => [Number(firstValue(row, 'bin_id')), Number(firstValue(row, 'bin_count'))]));

		const histogram: ColumnHistogram = { bin_edges: [], bin_counts: [], quantiles: [] };
		for (let i = 0; i < numBins; i++) {
			histogram.bin_edges.push(String(minValue + binWidth * i));
			histogram.bin_counts.push(histEntries.get(i) ?? 0);
		}
		// The final bin edge is exclusive, so fold the overflow bin into the last bin.
		histogram.bin_counts[numBins - 1] += histEntries.get(numBins) ?? 0;
		histogram.bin_edges.push(String(minValue + binWidth * numBins));
		return histogram;
	}
}

/**
 * Reads a value from a result row by the alias it was selected under.
 *
 * ODBC drivers do not agree on the case of returned column names: some echo the alias as written,
 * others uppercase it (Oracle, Db2, Snowflake). Rather than force every alias to one case and hope,
 * the lookup tries the exact name first and then falls back to a case-insensitive match.
 */
function firstValue(row: Record<string, unknown> | undefined, alias: string): unknown {
	if (row === undefined) {
		return undefined;
	}
	if (Object.prototype.hasOwnProperty.call(row, alias)) {
		return row[alias];
	}
	const lower = alias.toLowerCase();
	for (const key of Object.keys(row)) {
		if (key.toLowerCase() === lower) {
			return row[key];
		}
	}
	return undefined;
}

/**
 * The escape character used for LIKE patterns, and the clause declaring it.
 *
 * Backslash would be the conventional choice, but MySQL treats backslash as an escape inside string
 * literals too, so `'\%'` reaches the pattern matcher as a bare `%` and the escaping silently does
 * nothing. `!` has no special meaning in a string literal on any backend. The bracket form SQL
 * Server accepts (`[%]`) is not an option either -- it is SQL Server's alone.
 */
const LIKE_ESCAPE_CHAR = '!';
const LIKE_ESCAPE_CLAUSE = `ESCAPE '${LIKE_ESCAPE_CHAR}'`;

/**
 * Escapes the LIKE wildcards in a search term, so a user searching for "100%" matches that text
 * rather than every row beginning "100". Paired with the ESCAPE clause the callers append.
 */
function escapeLikePattern(term: string): string {
	return term.replace(/[%_!]/g, match => `${LIKE_ESCAPE_CHAR}${match}`);
}

/** Type guard distinguishing a contiguous index range from an explicit index set. */
function isSelectionRange(spec: ArraySelection): spec is DataSelectionRange {
	return (spec as DataSelectionRange).first_index !== undefined;
}

/** Applies a thousands separator to the integer part of an already-formatted number string. */
function applyThousandsSep(formatted: string, sep: string): string {
	const negative = formatted.startsWith('-');
	const body = negative ? formatted.slice(1) : formatted;
	const [intPart, fracPart] = body.split('.');
	const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
	const result = fracPart === undefined ? grouped : `${grouped}.${fracPart}`;
	return negative ? `-${result}` : result;
}

/** Formats a floating-point value following the Data Explorer FormatOptions. */
function formatFloat(value: number, opts: FormatOptions): string {
	const sciLimit = Math.pow(10, opts.max_integral_digits);
	let formatted: string;
	const abs = Math.abs(value);
	if (abs !== 0 && abs >= sciLimit) {
		return value.toExponential(opts.large_num_digits);
	} else if (abs !== 0 && abs < 1) {
		formatted = value.toFixed(opts.small_num_digits);
	} else {
		formatted = value.toFixed(opts.large_num_digits);
	}
	return opts.thousands_sep ? applyThousandsSep(formatted, opts.thousands_sep) : formatted;
}

/** Formats an integer value (number or bigint), optionally with a thousands separator. */
function formatInteger(value: number | bigint, opts: FormatOptions): string {
	const formatted = value.toString();
	return opts.thousands_sep ? applyThousandsSep(formatted, opts.thousands_sep) : formatted;
}

/** Truncates a string to the configured maximum formatted length. */
function truncate(value: string, opts: FormatOptions): string {
	return value.length > opts.max_value_length ? value.slice(0, opts.max_value_length) : value;
}

/** Stringifies a raw ODBC value for export, rendering null as 'NULL' and binary compactly. */
function stringifyExportCell(value: unknown): string {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	return String(value);
}

/** Renders an export matrix (header row + data rows) into the requested format. */
function formatExport(matrix: string[][], format: ExportFormat): string {
	switch (format) {
		case ExportFormat.Csv:
			return matrix.map(row => row.join(',')).join('\n');
		case ExportFormat.Tsv:
			return matrix.map(row => row.join('\t')).join('\n');
		case ExportFormat.Html:
			return matrix.map(row => `<tr><td>${row.join('</td><td>')}</td></tr>`).join('\n');
		default:
			throw new Error(`Unknown export format: ${format}`);
	}
}
