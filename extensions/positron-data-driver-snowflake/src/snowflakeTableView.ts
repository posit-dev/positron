/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Cloned from positron-data-driver-redshift's redshiftTableView.ts. The Data Explorer protocol
// handling is identical; the SQL is adapted to Snowflake's dialect. Known divergences:
//   - Aliases are double-quoted. Snowflake uppercases unquoted identifiers, so an unquoted alias like
//     `agg_total` would come back keyed as `AGG_TOTAL`; quoting preserves the exact case the code
//     reads back.
//   - Regex row filters use REGEXP_LIKE(subject, pattern, params). Snowflake's regex requires the
//     pattern to match the whole subject, so the term is wrapped in `.*...*` to keep Postgres-style
//     "contains" semantics; case-insensitivity is the 'i' parameter rather than a separate operator.
//   - No stable per-row identifier (no ctid). ROW_NUMBER() windows fall back to ordering by the first
//     column when no sort is set, because Snowflake requires an ORDER BY inside the window.
//   - Semi-structured values (VARIANT, OBJECT, ARRAY) are rendered as their JSON text.

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
	ColumnSchema,
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

/** The query surface the table view needs. Implemented by the connection over its sdk client. */
export interface ISnowflakeQueryClient {
	/** Run a SQL query and return its rows as plain objects keyed by column name. */
	runQuery(sql: string): Promise<Array<Record<string, unknown>>>;
}

/**
 * A minimal sink for the table view's diagnostic logging, so the class stays decoupled from vscode.
 * Structurally satisfied by a `vscode.LogOutputChannel`. Optional throughout; when absent, nothing
 * is logged.
 */
export interface IProfileLogger {
	info(message: string): void;
}

/**
 * Cancellation signal for a column-profile pass. The RPC handler flips this when a newer request for
 * the same dataset arrives, and the pass abandons itself at the next statement boundary so a burst of
 * requests can't stack statements on the single connection. Structurally satisfied by a
 * `vscode.CancellationToken`.
 */
export interface IProfileCancellation {
	readonly isCancellationRequested: boolean;
}

/** Sentinel codes for special cell values, matching the Data Explorer wire protocol. */
const SENTINEL_NULL = 0;
const SENTINEL_NAN = 2;
const SENTINEL_INF = 10;
const SENTINEL_NEGINF = 11;

/** A column in a Snowflake table or view, with its declared type and resolved display type. */
export interface SnowflakeSchemaEntry {
	column_name: string;
	/** The Snowflake type from INFORMATION_SCHEMA (e.g. 'NUMBER', 'TEXT', 'TIMESTAMP_NTZ'). */
	column_type: string;
	type_display: ColumnDisplayType;
}

/**
 * Maps a Snowflake column type name (from INFORMATION_SCHEMA.COLUMNS.DATA_TYPE) to a Data Explorer
 * display type. Snowflake stores every fixed-point number as 'NUMBER', so the numeric scale
 * distinguishes an integer (scale 0) from a decimal.
 */
export function snowflakeDisplayType(dataType: string, numericScale?: number | null): ColumnDisplayType {
	const type = dataType.toLowerCase();

	if (type.includes('bool')) {
		return ColumnDisplayType.Boolean;
	}
	if (type.includes('timestamp') || type.includes('datetime')) {
		return ColumnDisplayType.Datetime;
	}
	if (type === 'date') {
		return ColumnDisplayType.Date;
	}
	if (type.includes('time')) {
		return ColumnDisplayType.Time;
	}
	if (type.includes('float') || type.includes('double') || type.includes('real')) {
		return ColumnDisplayType.Floating;
	}
	if (type.includes('number') || type.includes('numeric') || type.includes('decimal') || type === 'fixed') {
		return numericScale !== undefined && numericScale !== null && numericScale > 0
			? ColumnDisplayType.Decimal
			: ColumnDisplayType.Integer;
	}
	if (type.includes('int')) {
		return ColumnDisplayType.Integer;
	}
	if (type.includes('char') || type.includes('text') || type.includes('string')) {
		return ColumnDisplayType.String;
	}
	// variant, object, array, binary, geography, geometry, etc. render as strings for now.
	return ColumnDisplayType.String;
}

/** Quotes and escapes an identifier for Snowflake by doubling embedded double-quotes. */
function quoteIdentifier(name: string): string {
	return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Escapes a value for use inside a single-quoted Snowflake string literal. Snowflake processes
 * backslash escape sequences inside single-quoted literals, so both backslashes and single quotes are
 * escaped.
 */
function quoteLiteral(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, '\'\'');
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
 * Formats a filter literal for its column type. String and temporal values are single-quoted and
 * escaped; temporal values are additionally cast to their Snowflake type so the quoted string is
 * compared as a date/time rather than parsed as bare arithmetic (e.g. `2026-07-22` would otherwise be
 * read as `2026 - 7 - 22`). Numbers and booleans are safe unquoted, so they pass through.
 */
function formatLiteral(value: string, schema: ColumnSchema): string {
	switch (schema.type_display) {
		case ColumnDisplayType.String:
			return `'${quoteLiteral(value)}'`;
		case ColumnDisplayType.Date:
			return `'${quoteLiteral(value)}'::DATE`;
		case ColumnDisplayType.Datetime:
			return `'${quoteLiteral(value)}'::TIMESTAMP`;
		case ColumnDisplayType.Time:
			return `'${quoteLiteral(value)}'::TIME`;
		default:
			return value;
	}
}

/**
 * Builds a SQL WHERE expression for a single row filter: set membership uses `IN (...)`, booleans
 * compare to `true`/`false`, and regex uses REGEXP_LIKE.
 */
export function makeWhereExpr(rowFilter: RowFilter): string {
	const schema = rowFilter.column_schema;
	const quotedName = quoteIdentifier(schema.column_name);
	switch (rowFilter.filter_type) {
		case RowFilterType.Compare: {
			const params = rowFilter.params as FilterComparison;
			const op: string = COMPARISON_OPS.get(params.op) ?? params.op;
			return `${quotedName} ${op} ${formatLiteral(params.value, schema)}`;
		}
		case RowFilterType.NotBetween:
		case RowFilterType.Between: {
			const params = rowFilter.params as FilterBetween;
			const left = formatLiteral(params.left_value, schema);
			const right = formatLiteral(params.right_value, schema);
			const expr = `${quotedName} BETWEEN ${left} AND ${right}`;
			return rowFilter.filter_type === RowFilterType.NotBetween ? `(NOT (${expr}))` : expr;
		}
		case RowFilterType.IsEmpty:
			return `${quotedName} = ''`;
		case RowFilterType.NotEmpty:
			return `${quotedName} <> ''`;
		case RowFilterType.IsFalse:
			return `${quotedName} = false`;
		case RowFilterType.IsTrue:
			return `${quotedName} = true`;
		case RowFilterType.IsNull:
			return `${quotedName} IS NULL`;
		case RowFilterType.NotNull:
			return `${quotedName} IS NOT NULL`;
		case RowFilterType.Search: {
			const params = rowFilter.params as FilterTextSearch;
			const searchArg = params.case_sensitive ? quotedName : `lower(${quotedName})`;
			const term = params.case_sensitive
				? `'${quoteLiteral(params.term)}'`
				: `lower('${quoteLiteral(params.term)}')`;
			switch (params.search_type) {
				case TextSearchType.Contains:
					return `${searchArg} LIKE '%' || ${term} || '%'`;
				case TextSearchType.NotContains:
					return `${searchArg} NOT LIKE '%' || ${term} || '%'`;
				case TextSearchType.StartsWith:
					return `${searchArg} LIKE ${term} || '%'`;
				case TextSearchType.EndsWith:
					return `${searchArg} LIKE '%' || ${term}`;
				case TextSearchType.RegexMatch:
					// Snowflake's REGEXP_LIKE matches the whole subject, so wrap the term in `.*...*` to
					// mimic Postgres-style partial matching; case-insensitivity is the 'i' parameter.
					return `REGEXP_LIKE(${quotedName}, '.*' || '${quoteLiteral(params.term)}' || '.*', '${params.case_sensitive ? 'c' : 'i'}')`;
			}
			return 'TRUE';
		}
		case RowFilterType.SetMembership: {
			const params = rowFilter.params as FilterSetMembership;
			const op = params.inclusive ? 'IN' : 'NOT IN';
			const values = params.values.map(x => formatLiteral(x, schema)).join(', ');
			return `${quotedName} ${op} (${values})`;
		}
	}
	return 'TRUE';
}

/**
 * Column-indexed aliases for the batched scalar-aggregate query, so the SELECT that emits them and
 * the code that reads them back stay in lockstep. Every alias is emitted double-quoted (see
 * `_quoteAlias`) so Snowflake preserves the exact case these keys use.
 */
const aggAlias = {
	total: 'agg_total',
	nonNull: (i: number) => `agg_nn_${i}`,
	n: (i: number) => `agg_n_${i}`,
	lo: (i: number) => `agg_lo_${i}`,
	hi: (i: number) => `agg_hi_${i}`,
	sum: (i: number) => `agg_s_${i}`,
	sumSq: (i: number) => `agg_ss_${i}`,
	numUnique: (i: number) => `agg_nu_${i}`,
	numEmpty: (i: number) => `agg_ne_${i}`,
	numTrue: (i: number) => `agg_nt_${i}`,
	numFalse: (i: number) => `agg_nf_${i}`,
	median: (i: number) => `agg_med_${i}`,
};

/** Wraps an alias in double quotes so Snowflake keeps its exact (lowercase) case in the result set. */
function quoteAlias(alias: string): string {
	return `"${alias}"`;
}

/** A column's histogram binning, planned client-side from the scalar row; its bins come from a batch query. */
interface HistogramPlan {
	columnIndex: number;
	quotedName: string;
	nonNull: number;
	nullCount: number;
	min: number;
	max: number;
	numBins: number;
	binWidth: number;
	degenerate: boolean;
}

/**
 * Serves Data Explorer requests for a single Snowflake table or view. Translates each protocol
 * method into SQL run through the connection's sdk client. Values are fetched raw and formatted in
 * TypeScript, while filtering, sorting, counts, and aggregations are pushed into SQL.
 */
export class SnowflakeTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];

	private _whereClause: string = '';
	private _sortClause: string = '';

	private _unfilteredRows: Promise<number>;
	private _filteredRows: Promise<number>;

	// Per-pass diagnostics for column profiling: a monotonically increasing pass id and the count of
	// queries issued in the current pass, so the log can attribute each query to a pass and report a
	// total. Overlapping passes (rare; the frontend cancels the prior one) may share the latest id.
	private _profilePassId = 0;
	private _profileQueryCount = 0;

	/**
	 * @param client The query client for the owning connection.
	 * @param tableRef The schema-qualified, already-quoted table reference (e.g. `"db"."public"."t"`).
	 * @param displayName The unqualified table/view name for display.
	 * @param objectKind Whether this is a table or a view. Retained for parity with the sibling
	 *   drivers and future per-kind handling; Snowflake has no ctid, so it does not affect sorting.
	 * @param schema The resolved column schema.
	 * @param _logger Optional diagnostic log sink for the column-profile query timeline.
	 */
	constructor(
		private readonly client: ISnowflakeQueryClient,
		private readonly tableRef: string,
		private readonly displayName: string,
		private readonly objectKind: 'table' | 'view',
		private readonly schema: Array<SnowflakeSchemaEntry>,
		private readonly _logger?: IProfileLogger,
	) {
		this._unfilteredRows = this._countRows('');
		this._filteredRows = this._unfilteredRows;
	}

	/** The (schema-qualified, quoted) table reference for use in FROM clauses. */
	private get _quotedTable(): string {
		return this.tableRef;
	}

	private async _countRows(whereClause: string): Promise<number> {
		const rows = await this.client.runQuery(`SELECT count(*) AS "n" FROM ${this._quotedTable}${whereClause}`);
		return Number(rows[0]?.n ?? 0);
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
		const selectors = params.columns.map((column, i) =>
			`${quoteIdentifier(this.schema[column.column_index].column_name)} AS ${quoteAlias(`c${i}`)}`);
		const query = `SELECT ${selectors.join(', ')} FROM ${this._quotedTable}` +
			`${this._whereClause}${this._orderClause()} LIMIT ${numRows} OFFSET ${lowerLimit}`;
		const rows = await this.client.runQuery(query);

		const result: TableData = { columns: [] };
		for (let i = 0; i < params.columns.length; i++) {
			const column = params.columns[i];
			const displayType = this.schema[column.column_index].type_display;
			const format = (absIndex: number): ColumnValue => {
				const row = rows[absIndex - lowerLimit];
				return row === undefined
					? SENTINEL_NULL
					: this._formatValue(row[`c${i}`], displayType, params.format_options);
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
	 * Formats a raw Snowflake value into the Data Explorer cell encoding: a sentinel number for
	 * null/NaN/+-Inf, otherwise a formatted string. snowflake-sdk returns temporal types as Date
	 * objects or strings, booleans as JS booleans, and semi-structured VARIANT/OBJECT/ARRAY values as
	 * parsed JS objects (rendered here as their JSON text).
	 */
	private _formatValue(value: unknown, displayType: ColumnDisplayType, opts: FormatOptions): ColumnValue {
		if (value === null || value === undefined) {
			return SENTINEL_NULL;
		}
		if (value instanceof Date) {
			return truncate(value.toISOString(), opts);
		}

		switch (displayType) {
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
				return typeof value === 'boolean' ? (value ? 'true' : 'false') : truncate(String(value), opts);
			case ColumnDisplayType.Object:
				if (value instanceof Uint8Array) {
					return `[${value.byteLength} bytes]`;
				}
				return truncate(stringifyValue(value), opts);
			default:
				return truncate(stringifyValue(value), opts);
		}
	}

	async setRowFilters(params: SetRowFiltersParams): Promise<FilterResult> {
		this.rowFilters = params.filters;
		if (this.rowFilters.length === 0) {
			this._whereClause = '';
			this._filteredRows = this._unfilteredRows;
		} else {
			this._whereClause = `\nWHERE ${this.rowFilters.map(makeWhereExpr).join(' AND ')}`;
			this._filteredRows = this._countRows(this._whereClause);
		}
		return { selected_num_rows: await this._filteredRows };
	}

	async setSortColumns(params: SetSortColumnsParams): Promise<void> {
		this.sortKeys = params.sort_keys;
		this._sortClause = this._buildSortClause(this.sortKeys);
	}

	/**
	 * Builds an ORDER BY clause for the given sort keys. Snowflake has no ctid (or any per-row
	 * identifier), so no tiebreaker is appended and pagination over a non-unique key may not be stable
	 * across pages.
	 */
	private _buildSortClause(sortKeys: Array<ColumnSortKey>): string {
		const exprs = sortKeys.map(key => {
			const quotedName = quoteIdentifier(this.schema[key.column_index].column_name);
			return `${quotedName}${key.ascending ? '' : ' DESC'}`;
		});
		return exprs.length > 0 ? `\nORDER BY ${exprs.join(', ')}` : '';
	}

	/** The ORDER BY clause used for data/export queries. */
	private _orderClause(): string {
		return this._sortClause;
	}

	async getState(): Promise<BackendState> {
		const [unfilteredRows, filteredRows] = await Promise.all([this._unfilteredRows, this._filteredRows]);
		const numColumns = this.schema.length;
		return {
			display_name: this.displayName,
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
		const sortClause = this._buildSortClause(this.sortKeys).replace(/\n/g, ' ').trim();
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
		const order = this._orderClause();

		const runExport = async (query: string, columns: Array<SnowflakeSchemaEntry>): Promise<ExportedData> => {
			const rows = await this.client.runQuery(query);
			const matrix = [
				columns.map(c => c.column_name),
				...rows.map(row => columns.map((_, i) => stringifyExportCell(row[`c${i}`]))),
			];
			return { data: formatExport(matrix, params.format), format: params.format };
		};

		const selectorsFor = (columns: Array<SnowflakeSchemaEntry>) =>
			columns.map((c, i) => `${quoteIdentifier(c.column_name)} AS ${quoteAlias(`c${i}`)}`).join(', ');

		switch (kind) {
			case TableSelectionKind.SingleCell: {
				const sel = params.selection.selection as DataSelectionSingleCell;
				const column = this.schema[sel.column_index];
				const query = `SELECT ${quoteIdentifier(column.column_name)} AS ${quoteAlias('c0')} FROM ${this._quotedTable}` +
					`${this._whereClause}${order} LIMIT 1 OFFSET ${sel.row_index}`;
				const rows = await this.client.runQuery(query);
				return { data: stringifyExportCell(rows[0]?.c0), format: params.format };
			}
			case TableSelectionKind.CellRange: {
				const sel = params.selection.selection as DataSelectionCellRange;
				const columns = this.schema.slice(sel.first_column_index, sel.last_column_index + 1);
				const query = `SELECT ${selectorsFor(columns)} FROM ${this._quotedTable}` +
					`${this._whereClause}${order} LIMIT ${sel.last_row_index - sel.first_row_index + 1} OFFSET ${sel.first_row_index}`;
				return runExport(query, columns);
			}
			case TableSelectionKind.RowRange: {
				const sel = params.selection.selection as DataSelectionRange;
				const query = `SELECT ${selectorsFor(this.schema)} FROM ${this._quotedTable}` +
					`${this._whereClause}${order} LIMIT ${sel.last_index - sel.first_index + 1} OFFSET ${sel.first_index}`;
				return runExport(query, this.schema);
			}
			case TableSelectionKind.ColumnRange: {
				const sel = params.selection.selection as DataSelectionRange;
				const columns = this.schema.slice(sel.first_index, sel.last_index + 1);
				const query = `SELECT ${selectorsFor(columns)} FROM ${this._quotedTable}${this._whereClause}${order}`;
				return runExport(query, columns);
			}
			case TableSelectionKind.ColumnIndices: {
				const sel = params.selection.selection as DataSelectionIndices;
				const columns = sel.indices.map(i => this.schema[i]);
				const query = `SELECT ${selectorsFor(columns)} FROM ${this._quotedTable}${this._whereClause}${order}`;
				return runExport(query, columns);
			}
			case TableSelectionKind.RowIndices: {
				const sel = params.selection.selection as DataSelectionIndices;
				const query = this._rowIndexQuery(selectorsFor(this.schema), sel.indices);
				return runExport(query, this.schema);
			}
			case TableSelectionKind.CellIndices: {
				const sel = params.selection.selection as DataSelectionCellIndices;
				const columns = sel.column_indices.map(i => this.schema[i]);
				const query = this._rowIndexQuery(selectorsFor(columns), sel.row_indices);
				return runExport(query, columns);
			}
		}
	}

	/**
	 * Builds a query that selects specific (post-sort, post-filter) row positions in the requested
	 * order. Uses a ROW_NUMBER() window so it works for both tables and views. Snowflake requires an
	 * ORDER BY inside the window, so when no sort is set the window falls back to ordering by the first
	 * column (Snowflake has no ctid to use as a stable identifier).
	 */
	private _rowIndexQuery(selectors: string, rowIndices: number[]): string {
		const fallbackOrder = this.schema.length > 0
			? `ORDER BY ${quoteIdentifier(this.schema[0].column_name)}`
			: 'ORDER BY 1';
		const ordering = this._sortClause ? this._sortClause.replace(/^\n/, '') : fallbackOrder;
		const numbered = `SELECT *, ROW_NUMBER() OVER (${ordering}) - 1 AS ${quoteAlias('__row_index')} ` +
			`FROM ${this._quotedTable}${this._whereClause}`;
		const order = rowIndices.map((rowIdx, i) => `WHEN ${rowIdx} THEN ${i}`).join(' ');
		const inList = rowIndices.join(', ');
		return `SELECT ${selectors} FROM (${numbered}) sub WHERE ${quoteAlias('__row_index')} IN (${inList}) ` +
			`ORDER BY CASE ${quoteAlias('__row_index')} ${order} END`;
	}

	/**
	 * Computes the requested column profiles. Returns the event payload to send to the frontend;
	 * the caller is responsible for delivering it (so this class stays free of vscode APIs).
	 *
	 * The whole batch is answered in at most three statements, independent of column count: one scalar
	 * scan (null counts, summary aggregates including an exact median, and each histogram's count and
	 * range), one UNION ALL for every histogram's bins, and one UNION ALL for every frequency table.
	 * Each column's result is then assembled from those three results with no further round-trips --
	 * the key to staying under budget on a warehouse where each statement carries fixed cost.
	 */
	async computeColumnProfiles(params: GetColumnProfilesParams, token?: IProfileCancellation): Promise<ReturnColumnProfilesEvent> {
		const passId = ++this._profilePassId;
		this._profileQueryCount = 0;
		const startedAt = Date.now();
		this._logger?.info(`[profiles #${passId}] ${this.displayName}: ${params.profiles.length} column(s) in one request; ${this._summarizeRequestedTypes(params.profiles)}`);

		// Bail at each statement boundary when a newer pass has superseded this one, so a burst of
		// requests doesn't queue every pass's statements on the single connection.
		const superseded = () => {
			if (token?.isCancellationRequested) {
				this._logger?.info(`[profiles #${passId}] ${this.displayName}: superseded after ${Date.now() - startedAt}ms, ${this._profileQueryCount} query/queries`);
				return true;
			}
			return false;
		};

		const filteredRows = await this._filteredRows;

		// An empty table has no data to scan, so every profile is trivially empty/zero. Answer the
		// whole batch from the (empty) scalar row without issuing a single query. This matters most for
		// Snowflake INFORMATION_SCHEMA views, where even an aggregate over zero rows is a slow metadata
		// query -- the count(*) that already established the table is empty is enough.
		if (filteredRows === 0) {
			const emptyScalar: Record<string, unknown> = {};
			const emptyPlans = this._planHistograms(params.profiles, emptyScalar, 0);
			const profiles = params.profiles.map(request =>
				this._assembleProfile(request, 0, params.format_options, emptyScalar, emptyPlans, new Map(), new Map()));
			this._logger?.info(`[profiles #${passId}] ${this.displayName}: 0 rows, answered without querying`);
			return { callback_id: params.callback_id, profiles };
		}

		const scalar = await this._scalarAggregates(params.profiles, filteredRows);
		if (superseded()) { return { callback_id: params.callback_id, profiles: [] }; }

		const histogramPlans = this._planHistograms(params.profiles, scalar, filteredRows);
		const histogramBins = await this._batchHistograms(histogramPlans);
		if (superseded()) { return { callback_id: params.callback_id, profiles: [] }; }

		const frequencyData = await this._batchFrequencyTables(params.profiles);
		if (superseded()) { return { callback_id: params.callback_id, profiles: [] }; }

		const profiles = params.profiles.map(request =>
			this._assembleProfile(request, filteredRows, params.format_options, scalar, histogramPlans, histogramBins, frequencyData));

		this._logger?.info(`[profiles #${passId}] ${this.displayName}: done in ${Date.now() - startedAt}ms across ${this._profileQueryCount} query/queries`);
		return { callback_id: params.callback_id, profiles };
	}

	/** Tallies the requested profile types across a batch for the pass-start log line. */
	private _summarizeRequestedTypes(requests: Array<ColumnProfileRequest>): string {
		const tally = new Map<string, number>();
		for (const request of requests) {
			for (const spec of request.profiles) {
				tally.set(spec.profile_type, (tally.get(spec.profile_type) ?? 0) + 1);
			}
		}
		return [...tally].map(([type, count]) => `${type} x${count}`).join(', ');
	}

	/**
	 * Runs a profile-pass query through the query client, timing it and logging it against the current
	 * pass. All column-profile SQL goes through here so the log shows the full per-pass query timeline.
	 */
	private async _profileQuery(label: string, sql: string): Promise<Array<Record<string, unknown>>> {
		const startedAt = Date.now();
		// Log before issuing so a query that hangs (never returns) is still visible in the timeline.
		this._logger?.info(`[profiles #${this._profilePassId}]   issuing ${label}...`);
		try {
			const rows = await this.client.runQuery(sql);
			this._profileQueryCount++;
			this._logger?.info(`[profiles #${this._profilePassId}]   ${label}: ${Date.now() - startedAt}ms, ${rows.length} row(s)`);
			return rows;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._logger?.info(`[profiles #${this._profilePassId}]   ${label}: FAILED after ${Date.now() - startedAt}ms: ${message}`);
			this._logger?.info(`[profiles #${this._profilePassId}]   failing SQL: ${sql}`);
			throw err;
		}
	}

	/**
	 * Runs one query computing every single-pass scalar aggregate requested across the batch: the
	 * non-null count for each column that asked for a null count, and the type-specific summary
	 * aggregates (moments, distinct/empty counts, min/max, true/false counts) for each column that
	 * asked for summary stats. Returns the single result row keyed by the aliases in `aggAlias`, or an
	 * empty row when nothing single-pass was requested (e.g. a histogram-only batch).
	 */
	private async _scalarAggregates(
		requests: Array<ColumnProfileRequest>,
		filteredRows: number,
	): Promise<Record<string, unknown>> {
		// Deduplicate by alias so a column that needs, say, min for both its summary stats and its
		// histogram contributes that expression once.
		const exprByAlias = new Map<string, string>();
		let needsTotal = false;
		const add = (alias: string, expr: string) => {
			if (!exprByAlias.has(alias)) {
				exprByAlias.set(alias, `${expr} AS ${quoteAlias(alias)}`);
			}
		};
		for (const request of requests) {
			const i = request.column_index;
			const entry = this.schema[i];
			const quotedName = quoteIdentifier(entry.column_name);
			for (const spec of request.profiles) {
				switch (spec.profile_type) {
					case ColumnProfileType.NullCount:
						needsTotal = true;
						add(aggAlias.nonNull(i), `count(${quotedName})`);
						break;
					case ColumnProfileType.SummaryStats:
						if (filteredRows > 0) {
							this._addSummaryNeeds(add, entry, quotedName, i);
						}
						break;
					case ColumnProfileType.SmallHistogram:
					case ColumnProfileType.LargeHistogram:
						// Histogram planning needs the count and range; the bins come from _batchHistograms.
						if (filteredRows > 0) {
							add(aggAlias.n(i), `count(${quotedName})`);
							add(aggAlias.lo(i), `min(${quotedName})`);
							add(aggAlias.hi(i), `max(${quotedName})`);
						}
						break;
					case ColumnProfileType.SmallFrequencyTable:
					case ColumnProfileType.LargeFrequencyTable:
						// The non-null count feeds the frequency table's "other" bucket.
						add(aggAlias.nonNull(i), `count(${quotedName})`);
						break;
					default:
						break;
				}
			}
		}
		const selects: Array<string> = [];
		// count(*) backs every column's null count, so select it once when any is needed.
		if (needsTotal) {
			selects.push(`count(*) AS ${quoteAlias(aggAlias.total)}`);
		}
		selects.push(...exprByAlias.values());
		if (selects.length === 0) {
			return {};
		}
		const rows = await this._profileQuery(
			`scalar aggregates (${selects.length} expr over the batch, one scan)`,
			`SELECT ${selects.join(', ')} FROM ${this._quotedTable}${this._whereClause}`);
		return rows[0] ?? {};
	}

	/** Adds a column's summary-stat aggregate expressions to the scalar query, by display type. */
	private _addSummaryNeeds(add: (alias: string, expr: string) => void, entry: SnowflakeSchemaEntry, quotedName: string, i: number): void {
		switch (entry.type_display) {
			case ColumnDisplayType.Integer:
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Decimal:
				add(aggAlias.n(i), `count(${quotedName})`);
				add(aggAlias.lo(i), `min(${quotedName})`);
				add(aggAlias.hi(i), `max(${quotedName})`);
				add(aggAlias.sum(i), `sum(${quotedName} * 1.0)`);
				add(aggAlias.sumSq(i), `sum(${quotedName} * 1.0 * ${quotedName})`);
				// Exact median folded in as an ordered-set aggregate -- no separate ORDER BY round-trip.
				add(aggAlias.median(i), `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${quotedName})`);
				break;
			case ColumnDisplayType.String:
				add(aggAlias.numUnique(i), `count(DISTINCT ${quotedName})`);
				add(aggAlias.numEmpty(i), `count(CASE WHEN ${quotedName} = '' THEN 1 END)`);
				break;
			case ColumnDisplayType.Boolean:
				// Snowflake has real booleans, so test the column directly rather than comparing to 0/1.
				add(aggAlias.numTrue(i), `count(CASE WHEN ${quotedName} THEN 1 END)`);
				add(aggAlias.numFalse(i), `count(CASE WHEN NOT ${quotedName} THEN 1 END)`);
				break;
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
				add(aggAlias.lo(i), `min(${quotedName})`);
				add(aggAlias.hi(i), `max(${quotedName})`);
				add(aggAlias.numUnique(i), `count(DISTINCT ${quotedName})`);
				break;
			default:
				add(aggAlias.numUnique(i), `count(DISTINCT ${quotedName})`);
				break;
		}
	}

	/** Assembles one column's profile result from the three precomputed statements -- no queries here. */
	private _assembleProfile(
		request: ColumnProfileRequest,
		filteredRows: number,
		formatOptions: FormatOptions,
		scalar: Record<string, unknown>,
		histogramPlans: Map<number, HistogramPlan>,
		histogramBins: Map<number, Map<number, number>>,
		frequencyData: Map<number, Array<{ value: string; freq: number }>>,
	): ColumnProfileResult {
		const entry = this.schema[request.column_index];
		const result: ColumnProfileResult = {};

		for (const spec of request.profiles) {
			switch (spec.profile_type) {
				case ColumnProfileType.NullCount:
					result.null_count = this._nullCountFromRow(request.column_index, scalar);
					break;
				case ColumnProfileType.SummaryStats:
					result.summary_stats = filteredRows === 0
						? this._emptySummaryStats(entry)
						: this._summaryStatsFromRow(entry, request.column_index, scalar, formatOptions);
					break;
				case ColumnProfileType.SmallFrequencyTable:
				case ColumnProfileType.LargeFrequencyTable:
					result[spec.profile_type] = this._buildFrequencyTable(
						frequencyData.get(request.column_index) ?? [], request.column_index, scalar);
					break;
				case ColumnProfileType.SmallHistogram:
				case ColumnProfileType.LargeHistogram: {
					const plan = histogramPlans.get(request.column_index);
					if (plan) {
						result[spec.profile_type] = this._buildHistogram(plan, histogramBins.get(request.column_index));
					}
					break;
				}
				default:
					break;
			}
		}
		return result;
	}

	/** Null count for a column, read from the batched scalar-aggregate row: total minus non-null. */
	private _nullCountFromRow(columnIndex: number, scalar: Record<string, unknown>): number {
		const total = Number(scalar[aggAlias.total] ?? 0);
		const nonNull = Number(scalar[aggAlias.nonNull(columnIndex)] ?? 0);
		return Math.max(0, total - nonNull);
	}

	private _wherePlus(predicate: string): string {
		return this._whereClause ? `${this._whereClause} AND ${predicate}` : `\nWHERE ${predicate}`;
	}

	/**
	 * Assembles a column's summary statistics from the batched scalar-aggregate row -- including the
	 * exact median, folded into that row as an ordered-set aggregate, so no query happens here.
	 */
	private _summaryStatsFromRow(
		entry: SnowflakeSchemaEntry,
		i: number,
		scalar: Record<string, unknown>,
		formatOptions: FormatOptions,
	): ColumnSummaryStats {
		const display = entry.type_display;
		if (display === ColumnDisplayType.Integer || display === ColumnDisplayType.Floating || display === ColumnDisplayType.Decimal) {
			const n = Number(scalar[aggAlias.n(i)] ?? 0);
			const sum = Number(scalar[aggAlias.sum(i)] ?? 0);
			const sumsq = Number(scalar[aggAlias.sumSq(i)] ?? 0);
			const lo = scalar[aggAlias.lo(i)];
			const hi = scalar[aggAlias.hi(i)];
			const medianRaw = scalar[aggAlias.median(i)];
			const mean = n > 0 ? sum / n : 0;
			// Sample standard deviation from the sums of values and squares.
			const variance = n > 1 ? Math.max(0, (sumsq - n * mean * mean) / (n - 1)) : 0;
			const fmt = (v: number) => formatFloat(v, formatOptions);
			return {
				type_display: display,
				number_stats: {
					min_value: lo === null || lo === undefined ? undefined : String(lo),
					max_value: hi === null || hi === undefined ? undefined : String(hi),
					mean: n > 0 ? fmt(mean) : undefined,
					median: medianRaw === null || medianRaw === undefined ? undefined : fmt(Number(medianRaw)),
					stdev: n > 1 ? fmt(Math.sqrt(variance)) : undefined,
				},
			};
		}
		if (display === ColumnDisplayType.String) {
			return {
				type_display: ColumnDisplayType.String,
				string_stats: {
					num_unique: Number(scalar[aggAlias.numUnique(i)] ?? 0),
					num_empty: Number(scalar[aggAlias.numEmpty(i)] ?? 0),
				},
			};
		}
		if (display === ColumnDisplayType.Boolean) {
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: {
					true_count: Number(scalar[aggAlias.numTrue(i)] ?? 0),
					false_count: Number(scalar[aggAlias.numFalse(i)] ?? 0),
				},
			};
		}
		if (display === ColumnDisplayType.Date || display === ColumnDisplayType.Datetime) {
			const lo = scalar[aggAlias.lo(i)];
			const hi = scalar[aggAlias.hi(i)];
			const stats = {
				num_unique: Number(scalar[aggAlias.numUnique(i)] ?? 0),
				min_date: lo === null || lo === undefined ? undefined : stringifyExportCell(lo),
				max_date: hi === null || hi === undefined ? undefined : stringifyExportCell(hi),
			};
			return display === ColumnDisplayType.Date
				? { type_display: display, date_stats: stats }
				: { type_display: display, datetime_stats: stats };
		}
		return { type_display: display, other_stats: { num_unique: Number(scalar[aggAlias.numUnique(i)] ?? 0) } };
	}

	private _emptySummaryStats(entry: SnowflakeSchemaEntry): ColumnSummaryStats {
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
	 * Plans each requested histogram from the scalar row (count and range), client-side. Degenerate
	 * cases -- no non-null values, or a single distinct value -- are marked so they need no bin query.
	 * Bin width uses a quantile-free rule (Sturges/fixed), so a requested Freedman-Diaconis method is
	 * approximated rather than costing the extra ordered-set round-trips its IQR would require.
	 */
	private _planHistograms(
		requests: Array<ColumnProfileRequest>,
		scalar: Record<string, unknown>,
		filteredRows: number,
	): Map<number, HistogramPlan> {
		const plans = new Map<number, HistogramPlan>();
		for (const request of requests) {
			const i = request.column_index;
			for (const spec of request.profiles) {
				if (spec.profile_type !== ColumnProfileType.SmallHistogram && spec.profile_type !== ColumnProfileType.LargeHistogram) {
					continue;
				}
				const entry = this.schema[i];
				const quotedName = quoteIdentifier(entry.column_name);
				const nonNull = filteredRows === 0 ? 0 : Number(scalar[aggAlias.n(i)] ?? 0);
				const nullCount = Math.max(0, filteredRows - nonNull);
				const min = Number(scalar[aggAlias.lo(i)]);
				const max = Number(scalar[aggAlias.hi(i)]);
				const peakToPeak = max - min;
				if (nonNull <= 0 || !isFinite(peakToPeak) || peakToPeak === 0) {
					plans.set(i, { columnIndex: i, quotedName, nonNull, nullCount, min, max, numBins: 0, binWidth: 0, degenerate: true });
				} else {
					const { numBins, binWidth } = this._histogramBinning(entry, min, max, nonNull, spec.params as ColumnHistogramParams);
					plans.set(i, { columnIndex: i, quotedName, nonNull, nullCount, min, max, numBins, binWidth, degenerate: false });
				}
			}
		}
		return plans;
	}

	/** Computes a histogram's bin count and width without quantiles, from the count and range. */
	private _histogramBinning(entry: SnowflakeSchemaEntry, min: number, max: number, nonNull: number, params: ColumnHistogramParams): { numBins: number; binWidth: number } {
		const peakToPeak = max - min;
		// Freedman-Diaconis needs the IQR (an ordered-set pass); approximate it with Sturges here to
		// keep the whole batch to three statements.
		let binWidth = params.method === ColumnHistogramParamsMethod.Fixed
			? peakToPeak / params.num_bins
			: peakToPeak / (Math.log2(nonNull) + 1);
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
		return { numBins, binWidth };
	}

	/**
	 * Computes every planned histogram's bins in a single UNION ALL statement: one bucketized GROUP BY
	 * branch per column, tagged by column index. Returns each column's bin-id -> count map.
	 */
	private async _batchHistograms(plans: Map<number, HistogramPlan>): Promise<Map<number, Map<number, number>>> {
		const active = [...plans.values()].filter(plan => !plan.degenerate);
		const bins = new Map<number, Map<number, number>>();
		if (active.length === 0) {
			return bins;
		}
		const branches = active.map(plan => {
			const bucket = `CAST(FLOOR((${plan.quotedName} * 1.0 - ${plan.min}) / ${plan.binWidth}) AS INTEGER)`;
			return `SELECT ${plan.columnIndex} AS ${quoteAlias('h_col')}, ${bucket} AS ${quoteAlias('h_bin')}, count(*) AS ${quoteAlias('h_count')} ` +
				`FROM ${this._quotedTable}${this._wherePlus(`${plan.quotedName} IS NOT NULL`)} GROUP BY ${bucket}`;
		});
		let rows: Array<Record<string, unknown>>;
		try {
			rows = await this._profileQuery(
				`histograms for ${active.length} column(s) (one UNION ALL)`,
				branches.join('\nUNION ALL\n'));
		} catch {
			// Degrade to empty histograms rather than failing the whole pass; the error is already logged.
			return bins;
		}
		for (const row of rows) {
			const col = Number(row.h_col);
			let entries = bins.get(col);
			if (!entries) {
				entries = new Map<number, number>();
				bins.set(col, entries);
			}
			entries.set(Number(row.h_bin), Number(row.h_count));
		}
		return bins;
	}

	/** Builds a ColumnHistogram from its plan and its bin-id -> count map (from _batchHistograms). */
	private _buildHistogram(plan: HistogramPlan, entries: Map<number, number> | undefined): ColumnHistogram {
		if (plan.nonNull <= 0) {
			return { bin_edges: ['NULL', 'NULL'], bin_counts: [plan.nullCount], quantiles: [] };
		}
		if (plan.degenerate) {
			// A single distinct value collapses to one bin.
			return { bin_edges: [String(plan.min), String(plan.max)], bin_counts: [plan.nonNull], quantiles: [] };
		}
		const counts = entries ?? new Map<number, number>();
		const histogram: ColumnHistogram = { bin_edges: [], bin_counts: [], quantiles: [] };
		for (let i = 0; i < plan.numBins; i++) {
			histogram.bin_edges.push(String(plan.min + plan.binWidth * i));
			histogram.bin_counts.push(counts.get(i) ?? 0);
		}
		// The final bin edge is exclusive, so fold the overflow bin into the last bin.
		histogram.bin_counts[plan.numBins - 1] += counts.get(plan.numBins) ?? 0;
		histogram.bin_edges.push(String(plan.min + plan.binWidth * plan.numBins));
		return histogram;
	}

	/**
	 * A text expression for a column's values in the frequency UNION ALL. Every branch must yield
	 * varchar so the branches union, but Snowflake won't implicitly cast several types: booleans render
	 * via CASE, semi-structured VARIANT/OBJECT/ARRAY via TO_VARCHAR, and spatial types via ST_ASWKT.
	 * Everything else casts directly. Any type still not covered is caught by _batchFrequencyTables,
	 * which drops the chunk's frequency tables rather than failing the whole pass.
	 */
	private _frequencyValueExpr(entry: SnowflakeSchemaEntry, quotedName: string): string {
		if (entry.type_display === ColumnDisplayType.Boolean) {
			return `CASE WHEN ${quotedName} THEN 'true' ELSE 'false' END`;
		}
		const rawType = entry.column_type.toLowerCase();
		if (rawType.includes('variant') || rawType.includes('object') || rawType.includes('array')) {
			return `TO_VARCHAR(${quotedName})`;
		}
		if (rawType.includes('geography') || rawType.includes('geometry')) {
			return `ST_ASWKT(${quotedName})`;
		}
		return `CAST(${quotedName} AS VARCHAR)`;
	}

	private async _batchFrequencyTables(requests: Array<ColumnProfileRequest>): Promise<Map<number, Array<{ value: string; freq: number }>>> {
		const branches: Array<string> = [];
		for (const request of requests) {
			const i = request.column_index;
			for (const spec of request.profiles) {
				if (spec.profile_type !== ColumnProfileType.SmallFrequencyTable && spec.profile_type !== ColumnProfileType.LargeFrequencyTable) {
					continue;
				}
				const entry = this.schema[i];
				const quotedName = quoteIdentifier(entry.column_name);
				const limit = (spec.params as ColumnFrequencyTableParams).limit;
				branches.push(
					`SELECT ${i} AS ${quoteAlias('f_col')}, ${quoteAlias('f_value')}, ${quoteAlias('f_freq')}, ${quoteAlias('f_rn')} FROM (` +
					`SELECT ${this._frequencyValueExpr(entry, quotedName)} AS ${quoteAlias('f_value')}, count(*) AS ${quoteAlias('f_freq')}, ` +
					`ROW_NUMBER() OVER (ORDER BY count(*) DESC, ${quotedName} ASC) AS ${quoteAlias('f_rn')} ` +
					`FROM ${this._quotedTable}${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY ${quotedName}` +
					`) sub WHERE ${quoteAlias('f_rn')} <= ${limit}`);
			}
		}
		if (branches.length === 0) {
			return new Map();
		}
		let rows: Array<Record<string, unknown>>;
		try {
			rows = await this._profileQuery(
				`frequency tables for ${branches.length} column(s) (one UNION ALL)`,
				branches.join('\nUNION ALL\n'));
		} catch {
			// A value type we couldn't render as text fails the whole UNION ALL. Rather than sink the
			// entire pass, drop this chunk's frequency tables; the failure and SQL are already logged.
			return new Map();
		}
		const collected = new Map<number, Array<{ value: string; freq: number; rn: number }>>();
		for (const row of rows) {
			const col = Number(row.f_col);
			let arr = collected.get(col);
			if (!arr) {
				arr = [];
				collected.set(col, arr);
			}
			arr.push({ value: String(row.f_value), freq: Number(row.f_freq), rn: Number(row.f_rn) });
		}
		// UNION ALL does not preserve per-branch ordering; restore top-k order via the row number.
		const ordered = new Map<number, Array<{ value: string; freq: number }>>();
		for (const [col, arr] of collected) {
			arr.sort((a, b) => a.rn - b.rn);
			ordered.set(col, arr.map(({ value, freq }) => ({ value, freq })));
		}
		return ordered;
	}

	/** Builds a ColumnFrequencyTable from its top values and the column's non-null count. */
	private _buildFrequencyTable(rows: Array<{ value: string; freq: number }>, i: number, scalar: Record<string, unknown>): ColumnFrequencyTable {
		const values: ColumnValue[] = [];
		const counts: number[] = [];
		let total = 0;
		for (const row of rows) {
			values.push(row.value);
			counts.push(row.freq);
			total += row.freq;
		}
		// other_count = filtered - shown - null = nonNull - shown (null count is filtered - nonNull).
		const nonNull = Number(scalar[aggAlias.nonNull(i)] ?? 0);
		return { values, counts, other_count: Math.max(0, nonNull - total) };
	}
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

/**
 * Stringifies a raw Snowflake value, rendering semi-structured VARIANT/OBJECT/ARRAY values (which
 * snowflake-sdk returns as parsed JS objects) as their JSON text rather than `[object Object]`.
 */
function stringifyValue(value: unknown): string {
	if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof Uint8Array)) {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

/** Stringifies a raw Snowflake value for export, rendering null as 'NULL' and dates as ISO. */
function stringifyExportCell(value: unknown): string {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (value instanceof Uint8Array) {
		return `[${value.byteLength} bytes]`;
	}
	return stringifyValue(value);
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
