/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Structurally mirrors positron-data-driver-sqlite's sqliteTableView.ts (the canonical
// template). The difference here is that no single SQL dialect is known: ADBC is the
// escape-hatch driver, so the database behind it may be anything the user has a driver
// for. Generated SQL therefore sticks to the portable core -- double-quoted identifiers,
// LIMIT/OFFSET, `||` concatenation, and aggregates every engine implements -- and column
// types come from the Arrow schema the driver reports rather than a vendor catalog.

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
import { IAdbcQueryClient } from './adbcWorkerClient.js';
import { QuoteIdentifier } from './adbcDialect.js';

/** Sentinel codes for special cell values, matching the Data Explorer wire protocol. */
const SENTINEL_NULL = 0;
const SENTINEL_NAN = 2;
const SENTINEL_INF = 10;
const SENTINEL_NEGINF = 11;

/**
 * The Arrow type ids (the `Type` enum in apache-arrow) the display-type mapping
 * distinguishes. Named here rather than imported so this module does not depend on
 * the ESM-only apache-arrow package; the ids are fixed by the Arrow format.
 */
const enum ArrowTypeId {
	Null = 1,
	Int = 2,
	Float = 3,
	Binary = 4,
	Utf8 = 5,
	Bool = 6,
	Decimal = 7,
	Date = 8,
	Time = 9,
	Timestamp = 10,
	Interval = 11,
	List = 12,
	Struct = 13,
	Union = 14,
	FixedSizeBinary = 15,
	FixedSizeList = 16,
	Map = 17,
	Duration = 18,
	LargeBinary = 19,
	LargeUtf8 = 20,
}

/** A column in an ADBC table or view, with its Arrow type and resolved display type. */
export interface AdbcSchemaEntry {
	column_name: string;
	/** The Arrow type rendered as a string (e.g. 'Int64', 'Timestamp<MICROSECOND>'). */
	column_type: string;
	type_display: ColumnDisplayType;
}

/**
 * Maps an Arrow type id to a Data Explorer display type. Arrow is the common
 * denominator across every ADBC driver, so this mapping serves them all -- unlike the
 * vendor-specific type-name matching the other drivers use.
 */
export function adbcDisplayType(typeId: number): ColumnDisplayType {
	switch (typeId) {
		case ArrowTypeId.Bool:
			return ColumnDisplayType.Boolean;
		case ArrowTypeId.Int:
			return ColumnDisplayType.Integer;
		case ArrowTypeId.Float:
			return ColumnDisplayType.Floating;
		case ArrowTypeId.Decimal:
			return ColumnDisplayType.Decimal;
		case ArrowTypeId.Utf8:
		case ArrowTypeId.LargeUtf8:
			return ColumnDisplayType.String;
		case ArrowTypeId.Date:
			return ColumnDisplayType.Date;
		case ArrowTypeId.Time:
			return ColumnDisplayType.Time;
		case ArrowTypeId.Timestamp:
			return ColumnDisplayType.Datetime;
		case ArrowTypeId.Interval:
		case ArrowTypeId.Duration:
			return ColumnDisplayType.Interval;
		case ArrowTypeId.List:
		case ArrowTypeId.FixedSizeList:
			return ColumnDisplayType.Array;
		case ArrowTypeId.Struct:
		case ArrowTypeId.Map:
		case ArrowTypeId.Union:
			return ColumnDisplayType.Struct;
		case ArrowTypeId.Binary:
		case ArrowTypeId.LargeBinary:
		case ArrowTypeId.FixedSizeBinary:
			return ColumnDisplayType.Object;
		case ArrowTypeId.Null:
			return ColumnDisplayType.Unknown;
		default:
			return ColumnDisplayType.Unknown;
	}
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

/** Formats a filter literal: string types are single-quoted and escaped; others pass through. */
function formatLiteral(value: string, schema: ColumnSchema): string {
	if (schema.type_display === ColumnDisplayType.String) {
		return `'${quoteLiteral(value)}'`;
	}
	return value;
}

/**
 * Builds a SQL WHERE expression for a single row filter, restricted to portable SQL.
 *
 * Regular-expression search is the one filter with no portable spelling -- engines vary
 * between `~`, `REGEXP`, `REGEXP_LIKE`, and no support at all -- so it throws rather
 * than silently matching the wrong rows. The error surfaces to the user as the failure
 * reason for the filter.
 */
export function makeWhereExpr(rowFilter: RowFilter, quote: QuoteIdentifier): string {
	const schema = rowFilter.column_schema;
	const quotedName = quote(schema.column_name);
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
			return `${quotedName} = FALSE`;
		case RowFilterType.IsTrue:
			return `${quotedName} = TRUE`;
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
					throw new Error('Regular-expression filters are not supported for ADBC connections, because SQL regex syntax differs between database engines. Use a "contains", "starts with", or "ends with" filter instead.');
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
 * Serves Data Explorer requests for a single ADBC table or view. Translates each
 * protocol method into portable SQL run through the connection's worker client. Values
 * are fetched raw and formatted in TypeScript, while filtering, sorting, counts, and
 * aggregations are pushed into SQL.
 */
export class AdbcTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];

	private _whereClause: string = '';
	private _sortClause: string = '';

	private _unfilteredRows: Promise<number>;
	private _filteredRows: Promise<number>;

	/**
	 * @param client The query client for the owning connection.
	 * @param tableRef The fully-qualified, already-quoted table reference.
	 * @param displayName The unqualified table/view name for display.
	 * @param schema The resolved column schema.
	 * @param quote Quotes an identifier in the connected engine's dialect. Supplied by the
	 * connection, which detects the dialect from what the driver reports about itself.
	 */
	constructor(
		private readonly client: IAdbcQueryClient,
		private readonly tableRef: string,
		private readonly displayName: string,
		private readonly schema: Array<AdbcSchemaEntry>,
		private readonly quote: QuoteIdentifier,
	) {
		this._unfilteredRows = this._countRows('');
		this._filteredRows = this._unfilteredRows;
	}

	/** The (qualified, quoted) table reference for use in FROM clauses. */
	private get _quotedTable(): string {
		return this.tableRef;
	}

	private async _countRows(whereClause: string): Promise<number> {
		const rows = await this.client.runQuery(`SELECT count(*) AS n FROM ${this._quotedTable}${whereClause}`);
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
			`${this.quote(this.schema[column.column_index].column_name)} AS c${i}`);
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
	 * Formats a raw ADBC value into the Data Explorer cell encoding: a sentinel number
	 * for null/NaN/+-Inf, otherwise a formatted string. The worker normalizes Arrow
	 * values before they cross IPC, so 64-bit integers arrive as bigint, timestamps as
	 * Date, binary as Buffer, and nested values as JSON text.
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
					return `[binary ${value.byteLength} bytes]`;
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
			this._whereClause = `\nWHERE ${this.rowFilters.map(filter => makeWhereExpr(filter, this.quote)).join(' AND ')}`;
			this._filteredRows = this._countRows(this._whereClause);
		}
		return { selected_num_rows: await this._filteredRows };
	}

	async setSortColumns(params: SetSortColumnsParams): Promise<void> {
		this.sortKeys = params.sort_keys;
		this._sortClause = this._buildSortClause(this.sortKeys);
	}

	/**
	 * Builds an ORDER BY clause for the given sort keys. Unlike the PostgreSQL and SQLite
	 * drivers there is no portable row identifier (`ctid`, `rowid`) to append as a
	 * tiebreaker, so rows that compare equal on every sort key may page in an
	 * unspecified order.
	 */
	private _buildSortClause(sortKeys: Array<ColumnSortKey>): string {
		const exprs = sortKeys.map(key => {
			const quotedName = this.quote(this.schema[key.column_index].column_name);
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

		const runExport = async (query: string, columns: Array<AdbcSchemaEntry>): Promise<ExportedData> => {
			const rows = await this.client.runQuery(query);
			const matrix = [
				columns.map(c => c.column_name),
				...rows.map(row => columns.map((_, i) => stringifyExportCell(row[`c${i}`]))),
			];
			return { data: formatExport(matrix, params.format), format: params.format };
		};

		const selectorsFor = (columns: Array<AdbcSchemaEntry>) =>
			columns.map((c, i) => `${this.quote(c.column_name)} AS c${i}`).join(', ');

		switch (kind) {
			case TableSelectionKind.SingleCell: {
				const sel = params.selection.selection as DataSelectionSingleCell;
				const column = this.schema[sel.column_index];
				const query = `SELECT ${this.quote(column.column_name)} AS c0 FROM ${this._quotedTable}` +
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
	 * Builds a query that selects specific (post-sort, post-filter) row positions in the
	 * requested order, using a ROW_NUMBER() window. Window functions are part of the SQL
	 * standard and supported by the engines ADBC drivers target.
	 */
	private _rowIndexQuery(selectors: string, rowIndices: number[]): string {
		const ordering = this._sortClause ? this._sortClause.replace(/^\n/, '') : '';
		const numbered = `SELECT *, ROW_NUMBER() OVER (${ordering}) - 1 AS __row_index ` +
			`FROM ${this._quotedTable}${this._whereClause}`;
		const order = rowIndices.map((rowIdx, i) => `WHEN ${rowIdx} THEN ${i}`).join(' ');
		const inList = rowIndices.join(', ');
		return `SELECT ${selectors} FROM (${numbered}) sub WHERE __row_index IN (${inList}) ` +
			`ORDER BY CASE __row_index ${order} END`;
	}

	/**
	 * Computes the requested column profiles. Returns the event payload to send to the
	 * frontend; the caller is responsible for delivering it (so this class stays free of
	 * vscode APIs).
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
		const quotedName = this.quote(entry.column_name);
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
			`SELECT count(*) - count(${quotedName}) AS n FROM ${this._quotedTable}${this._whereClause}`);
		return Number(rows[0]?.n ?? 0);
	}

	private _wherePlus(predicate: string): string {
		return this._whereClause ? `${this._whereClause} AND ${predicate}` : `\nWHERE ${predicate}`;
	}

	private async _summaryStats(
		entry: AdbcSchemaEntry,
		quotedName: string,
		formatOptions: FormatOptions,
	): Promise<ColumnSummaryStats> {
		const display = entry.type_display;
		if (display === ColumnDisplayType.Integer || display === ColumnDisplayType.Floating || display === ColumnDisplayType.Decimal) {
			// One pass for the moment-based stats; a second query for the median. The
			// standard deviation is derived from the sums of values and squares rather than
			// stddev_samp, which not every engine an ADBC driver fronts implements.
			const rows = await this.client.runQuery(
				`SELECT count(${quotedName}) AS n, min(${quotedName}) AS lo, max(${quotedName}) AS hi, ` +
				`sum(${quotedName} * 1.0) AS s, sum(${quotedName} * 1.0 * ${quotedName}) AS ss ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
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
				string_stats: { num_unique: Number(rows[0]?.nunique ?? 0), num_empty: Number(rows[0]?.nempty ?? 0) },
			};
		}
		if (display === ColumnDisplayType.Boolean) {
			const rows = await this.client.runQuery(
				`SELECT count(CASE WHEN ${quotedName} THEN 1 END) AS ntrue, ` +
				`count(CASE WHEN NOT ${quotedName} THEN 1 END) AS nfalse ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: { true_count: Number(rows[0]?.ntrue ?? 0), false_count: Number(rows[0]?.nfalse ?? 0) },
			};
		}
		if (display === ColumnDisplayType.Date || display === ColumnDisplayType.Datetime) {
			const rows = await this.client.runQuery(
				`SELECT min(${quotedName}) AS lo, max(${quotedName}) AS hi, count(DISTINCT ${quotedName}) AS nunique ` +
				`FROM ${this._quotedTable}${this._whereClause}`);
			const stats = {
				num_unique: Number(rows[0]?.nunique ?? 0),
				min_date: rows[0]?.lo === null || rows[0]?.lo === undefined ? undefined : stringifyExportCell(rows[0].lo),
				max_date: rows[0]?.hi === null || rows[0]?.hi === undefined ? undefined : stringifyExportCell(rows[0].hi),
			};
			return display === ColumnDisplayType.Date
				? { type_display: display, date_stats: stats }
				: { type_display: display, datetime_stats: stats };
		}
		const rows = await this.client.runQuery(
			`SELECT count(DISTINCT ${quotedName}) AS nunique FROM ${this._quotedTable}${this._whereClause}`);
		return { type_display: display, other_stats: { num_unique: Number(rows[0]?.nunique ?? 0) } };
	}

	private _emptySummaryStats(entry: AdbcSchemaEntry): ColumnSummaryStats {
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
	 * Computes a quantile (0..1) by ordering the non-null values and reading the value at
	 * the corresponding offset. `n` is the count of non-null values. Uses LIMIT/OFFSET
	 * rather than a percentile aggregate, which engines spell inconsistently.
	 */
	private async _quantile(quotedName: string, q: number, n: number): Promise<number | undefined> {
		if (n === 0) {
			return undefined;
		}
		const offset = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
		const rows = await this.client.runQuery(
			`SELECT ${quotedName} AS v FROM ${this._quotedTable}${this._wherePlus(`${quotedName} IS NOT NULL`)} ` +
			`ORDER BY ${quotedName} LIMIT 1 OFFSET ${offset}`);
		const value = rows[0]?.v;
		return value === null || value === undefined ? undefined : Number(value);
	}

	private async _frequencyTable(quotedName: string, limit: number, filteredRows: number): Promise<ColumnFrequencyTable> {
		const rows = await this.client.runQuery(
			`SELECT ${quotedName} AS value, count(*) AS freq FROM ${this._quotedTable}` +
			`${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY ${quotedName} ` +
			`ORDER BY freq DESC, value ASC LIMIT ${limit}`);
		const values: ColumnValue[] = [];
		const counts: number[] = [];
		let total = 0;
		for (const row of rows) {
			values.push(stringifyExportCell(row.value));
			const freq = Number(row.freq);
			counts.push(freq);
			total += freq;
		}
		const nullCount = await this._nullCount(quotedName);
		return { values, counts, other_count: Math.max(0, filteredRows - total - nullCount) };
	}

	private async _histogram(
		entry: AdbcSchemaEntry,
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

		const binRows = await this.client.runQuery(
			`SELECT CAST(FLOOR((${quotedName} * 1.0 - ${minValue}) / ${binWidth}) AS INTEGER) AS bin_id, count(*) AS bin_count ` +
			`FROM ${this._quotedTable}${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY bin_id`);
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

/** Stringifies a raw ADBC value for export, rendering null as 'NULL' and dates as ISO. */
function stringifyExportCell(value: unknown): string {
	if (value === null || value === undefined) {
		return 'NULL';
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (value instanceof Uint8Array) {
		return `[binary ${value.byteLength} bytes]`;
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
