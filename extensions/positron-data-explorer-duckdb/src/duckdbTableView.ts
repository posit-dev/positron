/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteTableView.ts (the canonical template);
// only the dialect-specific parts differ (display-type mapping, schema-qualified table reference,
// regexp_matches for regex filters, boolean literals, FLOOR cast for histogram bins).

import { IDuckDBReadPlan } from './duckdbReadPlan.js';
import { quoteIdentifier, quoteLiteral } from './duckdbSql.js';
import { IDuckDBQueryClient } from './duckdbWorkerClient.js';
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
import {
	formatDecimal,
	formatFloat,
	formatInteger,
	formatNumericStat,
	isDecimalLiteral,
	isIntegerLiteral,
	truncate,
} from 'positron-data-explorer-formatting';

/** Sentinel codes for special cell values, matching the Data Explorer wire protocol. */
const SENTINEL_NULL = 0;
const SENTINEL_NAN = 2;
const SENTINEL_INF = 10;
const SENTINEL_NEGINF = 11;

/** A column in a DuckDB table or view, with its declared type and resolved display type. */
export interface DuckDBSchemaEntry {
	column_name: string;
	/** The DuckDB type from information_schema (e.g. 'INTEGER', 'VARCHAR', 'DECIMAL(18,3)'). */
	column_type: string;
	type_display: ColumnDisplayType;
}

/**
 * Optional override for the Data Explorer's Convert-to-Code feature. A table view built with a
 * generator advertises these syntaxes in the Convert-to-Code dialog, pre-selects
 * {@link defaultSyntaxName}, and emits {@link generate} instead of the built-in DuckDB SQL.
 *
 * A consumer whose data is not a durable SQL table -- e.g. a pin previewed from a file downloaded
 * into an ephemeral in-memory database -- uses this to emit code that reads the real source (a
 * `pin_read(...)` call) rather than a `SELECT` against a throwaway local table the user cannot run.
 * Kept string-based (no protocol types) so consumers don't need a `positron-data-explorer-protocol`
 * dependency to implement it.
 */
export interface IDuckDBTableCodeGenerator {
	/** The syntax names offered in the Convert-to-Code dropdown (e.g. 'R', 'Python'). */
	readonly syntaxNames: readonly string[];
	/** The syntax pre-selected when the dialog opens; must be one of {@link syntaxNames}. */
	readonly defaultSyntaxName: string;
	/** Emits the code lines for the chosen syntax. Data Explorer filters/sorts are not represented. */
	generate(syntaxName: string): string[];
}

/**
 * Maps a DuckDB column type name (from information_schema.columns.data_type) to a Data Explorer
 * display type. Matches by substring so parameterized types (e.g. DECIMAL(18,3)) resolve correctly.
 */
export function duckdbDisplayType(dataType: string): ColumnDisplayType {
	const type = dataType.toUpperCase();

	if (type.includes('BOOL')) {
		return ColumnDisplayType.Boolean;
	}
	if (type.includes('TIMESTAMP') || type.includes('DATETIME')) {
		return ColumnDisplayType.Datetime;
	}
	if (type.includes('INTERVAL')) {
		return ColumnDisplayType.Interval;
	}
	if (type.includes('DATE')) {
		return ColumnDisplayType.Date;
	}
	if (type.includes('TIME')) {
		return ColumnDisplayType.Time;
	}
	if (type.includes('DECIMAL') || type.includes('NUMERIC')) {
		return ColumnDisplayType.Decimal;
	}
	if (type.includes('INT')) {
		return ColumnDisplayType.Integer;
	}
	if (type.includes('DOUBLE') || type.includes('FLOAT') || type.includes('REAL')) {
		return ColumnDisplayType.Floating;
	}
	if (type.includes('CHAR') || type.includes('TEXT') || type.includes('STRING') || type.includes('UUID')) {
		return ColumnDisplayType.String;
	}
	if (type.includes('BLOB') || type.includes('BYTEA')) {
		return ColumnDisplayType.Object;
	}
	// Anything else (JSON, nested types, etc.) renders as a string.
	return ColumnDisplayType.String;
}

const COMPARISON_OPS = new Map<FilterComparisonOp, string>([
	[FilterComparisonOp.Eq, '='],
	[FilterComparisonOp.NotEq, '<>'],
	[FilterComparisonOp.Gt, '>'],
	[FilterComparisonOp.GtEq, '>='],
	[FilterComparisonOp.Lt, '<'],
	[FilterComparisonOp.LtEq, '<=']
]);

/** Formats a filter literal: string types are single-quoted and escaped; others pass through. */
function formatLiteral(value: string, schema: ColumnSchema): string {
	if (schema.type_display === ColumnDisplayType.String) {
		return `'${quoteLiteral(value)}'`;
	}
	return value;
}

/**
 * Builds a SQL WHERE expression for a single row filter, in DuckDB dialect: set membership uses
 * `IN (...)`, booleans compare to `true`/`false`, and regex uses DuckDB's built-in `regexp_matches`.
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
				case TextSearchType.RegexMatch: {
					const options = params.case_sensitive ? '' : `, 'i'`;
					return `regexp_matches(${quotedName}, '${quoteLiteral(params.term)}'${options})`;
				}
			}
			return '1=1';
		}
		case RowFilterType.SetMembership: {
			const params = rowFilter.params as FilterSetMembership;
			const op = params.inclusive ? 'IN' : 'NOT IN';
			const values = params.values.map(x => formatLiteral(x, schema)).join(', ');
			return `${quotedName} ${op} (${values})`;
		}
	}
	return '1=1';
}

/**
 * Serves Data Explorer requests for a single DuckDB table or view. Translates each protocol method
 * into SQL run through the connection's worker client. Values are fetched raw and formatted in
 * TypeScript, while filtering, sorting, counts, and aggregations are pushed into SQL.
 */
export class DuckDBTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];

	private _whereClause: string = '';

	/**
	 * The ORDER BY for data and export queries. Empty until the user sorts, and deliberately so:
	 * DuckDB returns a scan of the relation in insertion order on its own, and the relations that
	 * cannot promise that are read through a snapshot that can. See {@link _buildSortClause}.
	 */
	private _sortClause: string = '';

	private _unfilteredRows: Promise<number>;
	private _filteredRows: Promise<number>;

	/**
	 * @param client The query client for the owning connection.
	 * @param tableRef The schema-qualified, already-quoted table reference (e.g. `"main"."t"`).
	 * @param displayName The unqualified table/view name for display.
	 * @param readPlan How this relation is read so that its LIMIT/OFFSET paging is stable.
	 * @param schema The resolved column schema.
	 * @param codeGenerator Optional Convert-to-Code override; when omitted, Convert-to-Code emits
	 * DuckDB SQL over the table reference.
	 */
	constructor(
		private readonly client: IDuckDBQueryClient,
		private readonly tableRef: string,
		private readonly displayName: string,
		private readonly readPlan: IDuckDBReadPlan,
		private readonly schema: Array<DuckDBSchemaEntry>,
		private readonly codeGenerator?: IDuckDBTableCodeGenerator,
	) {
		this._unfilteredRows = this._countRows('');
		this._filteredRows = this._unfilteredRows;
	}

	/**
	 * The quoted relation that reads should target. This is the snapshot rather than the original
	 * relation whenever the read plan uses one, so the row count, the displayed rows, the exports,
	 * and the column profiles all describe the same set of rows.
	 */
	private _relation(): Promise<string> {
		return this.readPlan.relation();
	}

	/** The user's own relation, for generated code that has to name what they opened. */
	private get _quotedTable(): string {
		return this.tableRef;
	}

	/** Releases the read plan's resources; call when the dataset's view is dropped. */
	async dispose(): Promise<void> {
		await this.readPlan.dispose();
	}

	private async _countRows(whereClause: string): Promise<number> {
		const rows = await this.client.runQuery(
			`SELECT count(*) AS n FROM ${await this._relation()}${whereClause}`);
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
			`${quoteIdentifier(this.schema[column.column_index].column_name)} AS c${i}`);
		const query = `SELECT ${selectors.join(', ')} FROM ${await this._relation()}` +
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
	 * Formats a raw DuckDB value into the Data Explorer cell encoding: a sentinel number for
	 * null/NaN/+-Inf, otherwise a formatted string.
	 */
	private _formatValue(value: unknown, displayType: ColumnDisplayType, opts: FormatOptions): ColumnValue {
		if (value === null || value === undefined) {
			return SENTINEL_NULL;
		}

		switch (displayType) {
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Decimal: {
				// `getRowObjectsJS` yields a JS number for DECIMAL columns, so a wide DECIMAL has already
				// lost its precision by the time it reaches here and this guard does not fire. Recovering
				// it means reading those columns as their exact text at the worker boundary, which is
				// separable work (see #15366); the exact-string path is shared with the other drivers so
				// it will simply start working once the values arrive intact.
				if (displayType === ColumnDisplayType.Decimal && isDecimalLiteral(value)) {
					return formatDecimal(value, opts);
				}
				const num = typeof value === 'number' ? value : Number(value);
				if (Number.isNaN(num)) { return SENTINEL_NAN; }
				if (num === Infinity) { return SENTINEL_INF; }
				if (num === -Infinity) { return SENTINEL_NEGINF; }
				return formatFloat(num, opts);
			}
			case ColumnDisplayType.Integer: {
				// Both wide integer shapes reach the formatter without passing through a JS number, which
				// would round anything beyond 2^53: a 64-bit integer arrives as a bigint, and a
				// DECIMAL(n,0) as an exact digit string. Anything else -- a plain number, or a string that
				// isn't a clean integer literal -- is coerced as before.
				const num = typeof value === 'bigint' || isIntegerLiteral(value) ? value : Number(value);
				return formatInteger(num, opts);
			}
			case ColumnDisplayType.Boolean:
				return typeof value === 'boolean' ? (value ? 'true' : 'false') : truncate(String(value), opts);
			case ColumnDisplayType.Object:
				// BLOB and other opaque values.
				if (value instanceof Uint8Array) {
					return `[BLOB ${value.byteLength} bytes]`;
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
			this._whereClause = `\nWHERE ${this.rowFilters.map(makeWhereExpr).join(' AND ')}`;
			this._filteredRows = this._countRows(this._whereClause);
		}
		return { selected_num_rows: await this._filteredRows };
	}

	async setSortColumns(params: SetSortColumnsParams): Promise<void> {
		this.sortKeys = params.sort_keys;
		this._sortClause = this._buildSortClause(this.sortKeys, true);
	}

	/**
	 * Builds an ORDER BY clause for the given sort keys, appending the read plan's row order as a
	 * tiebreaker so that sorting cannot leave tied rows free to move between pages.
	 *
	 * With no sort keys this deliberately emits no ORDER BY at all. DuckDB already returns a scan in
	 * insertion order, and it cannot tell that `rowid` order is that same order, so stating the
	 * tiebreaker anyway would sort the whole relation on every page to reproduce an order it was
	 * going to give for free -- measured at 7.4x over a 2M-row paged sweep, and 14x at a deep
	 * offset. Relations that have no such order are read through a snapshot that does; see
	 * {@link IDuckDBReadPlan}.
	 *
	 * @param includeTiebreaker False only for generated code, which should show the user their own
	 * sort rather than an internal ordering column.
	 */
	private _buildSortClause(sortKeys: Array<ColumnSortKey>, includeTiebreaker: boolean): string {
		const exprs = sortKeys.map(key => {
			const quotedName = quoteIdentifier(this.schema[key.column_index].column_name);
			return `${quotedName}${key.ascending ? '' : ' DESC'}`;
		});
		if (includeTiebreaker && exprs.length > 0) {
			exprs.push(this.readPlan.rowOrder);
		}
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
					code_syntaxes: this.codeGenerator
						? this.codeGenerator.syntaxNames.map(name => ({ code_syntax_name: name }))
						: [{ code_syntax_name: 'SQL' }],
				},
			},
		};
	}

	async convertToCode(params: ConvertToCodeParams): Promise<ConvertedCode> {
		// When a code generator is supplied, it fully owns the output (e.g. a pin_read snippet); the
		// Data Explorer's current filters/sorts do not map onto that source and are intentionally
		// dropped.
		if (this.codeGenerator) {
			// Read the syntax defensively: fall back to the generator's default if it is absent, so a
			// missing/renamed parameter degrades to sensible output instead of throwing.
			const syntaxName = params.code_syntax_name?.code_syntax_name ?? this.codeGenerator.defaultSyntaxName;
			return { converted_code: this.codeGenerator.generate(syntaxName) };
		}
		const result = ['SELECT *', `FROM ${this._quotedTable}`];
		if (this._whereClause) {
			result.push(this._whereClause.replace(/\n/g, ' ').trim());
		}
		const sortClause = this._buildSortClause(this.sortKeys, false).replace(/\n/g, ' ').trim();
		if (sortClause) {
			result.push(sortClause);
		}
		return { converted_code: result };
	}

	async suggestCodeSyntax(): Promise<CodeSyntaxName> {
		return { code_syntax_name: this.codeGenerator?.defaultSyntaxName ?? 'SQL' };
	}

	async exportDataSelection(params: ExportDataSelectionParams): Promise<ExportedData> {
		const kind = params.selection.kind;
		const order = this._orderClause();
		const relation = await this._relation();

		const runExport = async (query: string, columns: Array<DuckDBSchemaEntry>): Promise<ExportedData> => {
			const rows = await this.client.runQuery(query);
			const matrix = [
				columns.map(c => c.column_name),
				...rows.map(row => columns.map((_, i) => stringifyExportCell(row[`c${i}`]))),
			];
			return { data: formatExport(matrix, params.format), format: params.format };
		};

		const selectorsFor = (columns: Array<DuckDBSchemaEntry>) =>
			columns.map((c, i) => `${quoteIdentifier(c.column_name)} AS c${i}`).join(', ');

		switch (kind) {
			case TableSelectionKind.SingleCell: {
				const sel = params.selection.selection as DataSelectionSingleCell;
				const column = this.schema[sel.column_index];
				const query = `SELECT ${quoteIdentifier(column.column_name)} AS c0 FROM ${relation}` +
					`${this._whereClause}${order} LIMIT 1 OFFSET ${sel.row_index}`;
				const rows = await this.client.runQuery(query);
				return { data: stringifyExportCell(rows[0]?.c0), format: params.format };
			}
			case TableSelectionKind.CellRange: {
				const sel = params.selection.selection as DataSelectionCellRange;
				const columns = this.schema.slice(sel.first_column_index, sel.last_column_index + 1);
				const query = `SELECT ${selectorsFor(columns)} FROM ${relation}` +
					`${this._whereClause}${order} LIMIT ${sel.last_row_index - sel.first_row_index + 1} OFFSET ${sel.first_row_index}`;
				return runExport(query, columns);
			}
			case TableSelectionKind.RowRange: {
				const sel = params.selection.selection as DataSelectionRange;
				const query = `SELECT ${selectorsFor(this.schema)} FROM ${relation}` +
					`${this._whereClause}${order} LIMIT ${sel.last_index - sel.first_index + 1} OFFSET ${sel.first_index}`;
				return runExport(query, this.schema);
			}
			case TableSelectionKind.ColumnRange: {
				const sel = params.selection.selection as DataSelectionRange;
				const columns = this.schema.slice(sel.first_index, sel.last_index + 1);
				const query = `SELECT ${selectorsFor(columns)} FROM ${relation}${this._whereClause}${order}`;
				return runExport(query, columns);
			}
			case TableSelectionKind.ColumnIndices: {
				const sel = params.selection.selection as DataSelectionIndices;
				const columns = sel.indices.map(i => this.schema[i]);
				const query = `SELECT ${selectorsFor(columns)} FROM ${relation}${this._whereClause}${order}`;
				return runExport(query, columns);
			}
			case TableSelectionKind.RowIndices: {
				const sel = params.selection.selection as DataSelectionIndices;
				const query = this._rowIndexQuery(relation, selectorsFor(this.schema), sel.indices);
				return runExport(query, this.schema);
			}
			case TableSelectionKind.CellIndices: {
				const sel = params.selection.selection as DataSelectionCellIndices;
				const columns = sel.column_indices.map(i => this.schema[i]);
				const query = this._rowIndexQuery(relation, selectorsFor(columns), sel.row_indices);
				return runExport(query, columns);
			}
		}
	}

	/**
	 * Builds a query that selects specific (post-sort, post-filter) row positions in the requested
	 * order, using a ROW_NUMBER() window to number the rows.
	 *
	 * The window has to be ordered the same way the pages were, or the positions the frontend asks
	 * for refer to rows the user never saw there -- and this path writes a file the user keeps. It
	 * cannot be left unordered the way a paging query can: a window operator does not inherit the
	 * scan's insertion order, and numbering rows with a constant ORDER BY disagreed with the
	 * displayed order on all 171,429 rows of a measured relation.
	 */
	private _rowIndexQuery(relation: string, selectors: string, rowIndices: number[]): string {
		const ordering = this._sortClause
			? this._sortClause.replace(/^\n/, '')
			: `ORDER BY ${this.readPlan.rowOrder}`;
		const numbered = `SELECT *, ROW_NUMBER() OVER (${ordering}) - 1 AS __row_index ` +
			`FROM ${relation}${this._whereClause}`;
		const order = rowIndices.map((rowIdx, i) => `WHEN ${rowIdx} THEN ${i}`).join(' ');
		const inList = rowIndices.join(', ');
		return `SELECT ${selectors} FROM (${numbered}) WHERE __row_index IN (${inList}) ` +
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
		const quotedName = quoteIdentifier(entry.column_name);
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
					result[spec.profile_type] = await this._frequencyTable(
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
			`SELECT count(*) - count(${quotedName}) AS n FROM ${await this._relation()}${this._whereClause}`);
		return Number(rows[0]?.n ?? 0);
	}

	private _wherePlus(predicate: string): string {
		return this._whereClause ? `${this._whereClause} AND ${predicate}` : `\nWHERE ${predicate}`;
	}

	private async _summaryStats(
		entry: DuckDBSchemaEntry,
		quotedName: string,
		formatOptions: FormatOptions,
	): Promise<ColumnSummaryStats> {
		const display = entry.type_display;
		const relation = await this._relation();
		if (display === ColumnDisplayType.Integer || display === ColumnDisplayType.Floating || display === ColumnDisplayType.Decimal) {
			// One pass for the moment-based stats; a second query for the median.
			const rows = await this.client.runQuery(
				`SELECT count(${quotedName}) AS n, min(${quotedName}) AS lo, max(${quotedName}) AS hi, ` +
				`sum(${quotedName} * 1.0) AS s, sum(${quotedName} * 1.0 * ${quotedName}) AS ss ` +
				`FROM ${relation}${this._whereClause}`);
			const n = Number(rows[0]?.n ?? 0);
			const sum = Number(rows[0]?.s ?? 0);
			const sumsq = Number(rows[0]?.ss ?? 0);
			const mean = n > 0 ? sum / n : 0;
			// Sample standard deviation from the sums of values and squares.
			const variance = n > 1 ? Math.max(0, (sumsq - n * mean * mean) / (n - 1)) : 0;
			const median = await this._quantile(quotedName, 0.5, n);
			const fmt = (v: number) => formatFloat(v, formatOptions);
			return {
				type_display: display,
				number_stats: {
					min_value: rows[0]?.lo === null || rows[0]?.lo === undefined ? undefined : String(rows[0].lo),
					max_value: rows[0]?.hi === null || rows[0]?.hi === undefined ? undefined : String(rows[0].hi),
					mean: n > 0 ? fmt(mean) : undefined,
					median: formatNumericStat(median, display, formatOptions),
					stdev: n > 1 ? fmt(Math.sqrt(variance)) : undefined,
				},
			};
		}
		if (display === ColumnDisplayType.String) {
			const rows = await this.client.runQuery(
				`SELECT count(DISTINCT ${quotedName}) AS nunique, ` +
				`count(CASE WHEN ${quotedName} = '' THEN 1 END) AS nempty ` +
				`FROM ${relation}${this._whereClause}`);
			return {
				type_display: ColumnDisplayType.String,
				string_stats: { num_unique: Number(rows[0]?.nunique ?? 0), num_empty: Number(rows[0]?.nempty ?? 0) },
			};
		}
		if (display === ColumnDisplayType.Boolean) {
			// DuckDB has real booleans, so test the column directly rather than comparing to 0/1.
			const rows = await this.client.runQuery(
				`SELECT count(CASE WHEN ${quotedName} THEN 1 END) AS ntrue, ` +
				`count(CASE WHEN NOT ${quotedName} THEN 1 END) AS nfalse ` +
				`FROM ${relation}${this._whereClause}`);
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: { true_count: Number(rows[0]?.ntrue ?? 0), false_count: Number(rows[0]?.nfalse ?? 0) },
			};
		}
		if (display === ColumnDisplayType.Date || display === ColumnDisplayType.Datetime) {
			const rows = await this.client.runQuery(
				`SELECT min(${quotedName}) AS lo, max(${quotedName}) AS hi, count(DISTINCT ${quotedName}) AS nunique ` +
				`FROM ${relation}${this._whereClause}`);
			const stats = {
				num_unique: Number(rows[0]?.nunique ?? 0),
				min_date: rows[0]?.lo === null || rows[0]?.lo === undefined ? undefined : String(rows[0].lo),
				max_date: rows[0]?.hi === null || rows[0]?.hi === undefined ? undefined : String(rows[0].hi),
			};
			return display === ColumnDisplayType.Date
				? { type_display: display, date_stats: stats }
				: { type_display: display, datetime_stats: stats };
		}
		const rows = await this.client.runQuery(
			`SELECT count(DISTINCT ${quotedName}) AS nunique FROM ${relation}${this._whereClause}`);
		return { type_display: display, other_stats: { num_unique: Number(rows[0]?.nunique ?? 0) } };
	}

	private _emptySummaryStats(entry: DuckDBSchemaEntry): ColumnSummaryStats {
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
	 *
	 * Returns the raw cell value rather than a JS number, because its callers want different things
	 * from it. The median is reported to the user, and a DECIMAL/NUMERIC median arrives as an exact
	 * digit string that a double cannot hold, so `formatNumericStat` formats it textually. The
	 * histogram's interquartile range is arithmetic on a bin width, which is approximate either way,
	 * so those callers coerce.
	 */
	private async _quantile(quotedName: string, q: number, n: number): Promise<unknown> {
		if (n === 0) {
			return undefined;
		}
		const offset = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
		const rows = await this.client.runQuery(
			`SELECT ${quotedName} AS v FROM ${await this._relation()}${this._wherePlus(`${quotedName} IS NOT NULL`)} ` +
			`ORDER BY ${quotedName} LIMIT 1 OFFSET ${offset}`);
		const value = rows[0]?.v;
		return value === null ? undefined : value;
	}

	private async _frequencyTable(quotedName: string, limit: number, filteredRows: number): Promise<ColumnFrequencyTable> {
		const rows = await this.client.runQuery(
			`SELECT ${quotedName} AS value, count(*) AS freq FROM ${await this._relation()}` +
			`${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY ${quotedName} ` +
			`ORDER BY freq DESC, value ASC LIMIT ${limit}`);
		const values: ColumnValue[] = [];
		const counts: number[] = [];
		let total = 0;
		for (const row of rows) {
			values.push(String(row.value));
			const freq = Number(row.freq);
			counts.push(freq);
			total += freq;
		}
		const nullCount = await this._nullCount(quotedName);
		return { values, counts, other_count: Math.max(0, filteredRows - total - nullCount) };
	}

	private async _histogram(
		entry: DuckDBSchemaEntry,
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
			`SELECT min(${quotedName}) AS lo, max(${quotedName}) AS hi FROM ${await this._relation()}${this._whereClause}`);
		const minValue = Number(rows[0]?.lo);
		const maxValue = Number(rows[0]?.hi);
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
				const q1 = Number(await this._quantile(quotedName, 0.25, nonNull) ?? 0);
				const q3 = Number(await this._quantile(quotedName, 0.75, nonNull) ?? 0);
				const iqr = q3 - q1;
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

		const binRows = await this.client.runQuery(
			`SELECT CAST(FLOOR((${quotedName} * 1.0 - ${minValue}) / ${binWidth}) AS INTEGER) AS bin_id, count(*) AS bin_count ` +
			`FROM ${await this._relation()}${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY bin_id`);
		const histEntries = new Map<number, number>(
			binRows.map(row => [Number(row.bin_id), Number(row.bin_count)]));

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

/** Type guard distinguishing a contiguous index range from an explicit index set. */
function isSelectionRange(spec: ArraySelection): spec is DataSelectionRange {
	return (spec as DataSelectionRange).first_index !== undefined;
}

/** Stringifies a raw DuckDB value for export, rendering null as 'NULL' and BLOBs compactly. */
function stringifyExportCell(value: unknown): string {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	if (value instanceof Uint8Array) {
		return `[BLOB ${value.byteLength} bytes]`;
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
