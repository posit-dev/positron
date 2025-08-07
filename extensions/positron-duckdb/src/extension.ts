/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	BackendState,
	ColumnDisplayType,
	ColumnFilter,
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
	DataExplorerBackendRequest,
	DataExplorerFrontendEvent,
	DataExplorerResponse,
	DataExplorerRpc,
	DataExplorerUiEvent,
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
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetRowLabelsParams,
	GetSchemaParams,
	OpenDatasetParams,
	OpenDatasetResult,
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
	TableRowLabels,
	TableSchema,
	TableSelectionKind,
	TextSearchType
} from './interfaces';
import * as duckdb from '@duckdb/duckdb-wasm';
import * as path from 'path';
import * as zlib from 'zlib';
import Worker from 'web-worker';
import { Table, Vector } from 'apache-arrow';
import { pathToFileURL } from 'url';

// Set to true when doing development for better console logging
const DEBUG_LOG = false;

class DuckDBInstance {
	runningQuery: Promise<any> = Promise.resolve();

	constructor(readonly db: duckdb.AsyncDuckDB, readonly con: duckdb.AsyncDuckDBConnection) { }

	static async create(ctx: vscode.ExtensionContext): Promise<DuckDBInstance> {
		// Create the path to the DuckDB WASM bundle. Note that only the EH
		// bundle for Node is used for now as we don't support Positron
		// extensions running in a browser context yet.
		const distPath = path.join(ctx.extensionPath, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
		const bundle = {
			mainModule: path.join(distPath, 'duckdb-eh.wasm'),
			mainWorker: path.join(distPath, 'duckdb-node-eh.worker.cjs')
		};

		// On Windows, we need to call pathToFileURL on mainWorker because the web-worker package
		// does not support Windows paths that start with a drive letter.
		if (process.platform === 'win32') {
			bundle.mainWorker = pathToFileURL(bundle.mainWorker).toString();
		}

		const worker = new Worker(bundle.mainWorker);
		const logger = new duckdb.VoidLogger();
		const db = new duckdb.AsyncDuckDB(logger, worker);
		await db.instantiate(bundle.mainModule);

		const con = await db.connect();
		await con.query(`LOAD icu;
		SET TIMEZONE=\'UTC\';
		`);
		return new DuckDBInstance(db, con);
	}

	async runQuery(query: string): Promise<Table<any>> {
		await this.runningQuery;
		try {
			const startTime = Date.now();
			this.runningQuery = this.con.query(query);

			const result = await this.runningQuery;
			const elapsedMs = Date.now() - startTime;
			if (DEBUG_LOG) {
				console.log(`Took ${elapsedMs} ms to run:\n${query}`);
			}
			return result;
		} catch (error) {
			if (DEBUG_LOG) {
				console.log(`Failed to execute:\n${query}`);
			}
			this.runningQuery = Promise.resolve();
			return Promise.reject(error);
		}
	}

}

type RpcResponse<Type> = Promise<Type | string>;

/**
 * Format of a schema entry coming from DuckDB's DESCRIBE command
 */
interface SchemaEntry {
	column_name: string;
	column_type: string;
	null: string;
	key: string;
	default: string;
	extra: string;
}

const SENTINEL_NULL = 0;
const SENTINEL_NAN = 2;
const SENTINEL_INF = 10;
const SENTINEL_NEGINF = 11;

// TODO
// - Decimal
// - Nested types
// - JSON
const SCHEMA_TYPE_MAPPING = new Map<string, ColumnDisplayType>([
	['BOOLEAN', ColumnDisplayType.Boolean],
	['UTINYINT', ColumnDisplayType.Number],
	['TINYINT', ColumnDisplayType.Number],
	['USMALLINT', ColumnDisplayType.Number],
	['SMALLINT', ColumnDisplayType.Number],
	['UINTEGER', ColumnDisplayType.Number],
	['INTEGER', ColumnDisplayType.Number],
	['UBIGINT', ColumnDisplayType.Number],
	['BIGINT', ColumnDisplayType.Number],
	['FLOAT', ColumnDisplayType.Number],
	['DOUBLE', ColumnDisplayType.Number],
	['VARCHAR', ColumnDisplayType.String],
	['UUID', ColumnDisplayType.String],
	['DATE', ColumnDisplayType.Date],
	['TIMESTAMP', ColumnDisplayType.Datetime],
	['TIMESTAMP_NS', ColumnDisplayType.Datetime],
	['TIMESTAMP WITH TIME ZONE', ColumnDisplayType.Datetime],
	['TIMESTAMP_NS WITH TIME ZONE', ColumnDisplayType.Datetime],
	['TIME', ColumnDisplayType.Time],
	['INTERVAL', ColumnDisplayType.Interval],
	['DECIMAL', ColumnDisplayType.Number]
]);

function formatLiteral(value: string, schema: ColumnSchema) {
	if (schema.type_display === ColumnDisplayType.String) {
		return `'${value}'`;
	} else {
		return value;
	}
}

const COMPARISON_OPS = new Map<FilterComparisonOp, string>([
	[FilterComparisonOp.Eq, '='],
	[FilterComparisonOp.NotEq, '<>'],
	[FilterComparisonOp.Gt, '>'],
	[FilterComparisonOp.GtEq, '>='],
	[FilterComparisonOp.Lt, '<'],
	[FilterComparisonOp.LtEq, '<=']
]);

function makeWhereExpr(rowFilter: RowFilter): string {
	const schema = rowFilter.column_schema;
	const quotedName = quoteIdentifier(schema.column_name);
	switch (rowFilter.filter_type) {
		case RowFilterType.Compare: {
			const params = rowFilter.params as FilterComparison;
			const formattedValue = formatLiteral(params.value, schema);
			const op: string = COMPARISON_OPS.get(params.op) ?? params.op;
			return `${quotedName} ${op} ${formattedValue}`;
		}
		case RowFilterType.NotBetween:
		case RowFilterType.Between: {
			const params = rowFilter.params as FilterBetween;
			const left = formatLiteral(params.left_value, schema);
			const right = formatLiteral(params.right_value, schema);
			let expr = `${quotedName} BETWEEN ${left} AND ${right}`;
			if (rowFilter.filter_type === RowFilterType.NotBetween) {
				expr = `(NOT (${expr}))`;
			}
			return expr;
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
			const searchTerm = params.case_sensitive ? `'${params.term}'` : `lower('${params.term}')`;

			switch (params.search_type) {
				case TextSearchType.Contains:
					return `${searchArg} LIKE '%' || ${searchTerm} || '%'`;
				case TextSearchType.NotContains:
					return `${searchArg} NOT LIKE '%' || ${searchTerm} || '%'`;
				case TextSearchType.StartsWith:
					return `${searchArg} LIKE ${searchTerm} || '%'`;
				case TextSearchType.EndsWith:
					return `${searchArg} LIKE '%' || ${searchTerm}`;
				case TextSearchType.RegexMatch: {
					const options = params.case_sensitive ? ', \'i\'' : '';
					return `regexp_matches(${searchArg}, \'${params.term}\'${options})`;
				}
			}
		}
		case RowFilterType.SetMembership: {
			const params = rowFilter.params as FilterSetMembership;
			const op = params.inclusive ? 'IN' : 'NOT IN';
			const valuesLiteral = '[' + params.values.map((x) => formatLiteral(x, schema)).join(', ') + ']';
			return `${quotedName} ${op} ${valuesLiteral}`;
		}
	}
}

/**
 * Properly quotes and escapes an identifier for use in DuckDB SQL.
 * Handles field names containing quotes by doubling them (DuckDB's escaping convention).
 * @param fieldName The field name to quote
 * @returns The properly quoted and escaped identifier
 */
function quoteIdentifier(fieldName: string) {
	// Double any existing double quotes and wrap in double quotes
	return '"' + fieldName.replace(/"/g, '""') + '"';
}

function anyValue(unquotedName: string) {
	return `ANY_VALUE(${quoteIdentifier(unquotedName)})`;
}

function alias(expr: string, aliasName: string) {
	return `${expr} AS ${quoteIdentifier(aliasName)}`;
}

/**
 * Generates a safe column name for statistics based on a base field name and statistic type.
 * The returned name is safe to use in SQL and can be used to look up the value in the results.
 * Uses a hash of the field name to ensure the generated identifier is always valid SQL.
 *
 * @param fieldName The base field name
 * @param statType The type of statistic (e.g., 'mean', 'stdev')
 * @returns A safe column name that can be used in SQL
 */
function statColumnName(fieldName: string, statType: string): string {
	// Generate a simple hash of the field name to create a safe identifier
	let hash = 0;
	for (let i = 0; i < fieldName.length; i++) {
		const char = fieldName.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	// Use absolute value and convert to base36 for shorter representation
	const safeFieldHash = Math.abs(hash).toString(36);
	return `stat_${safeFieldHash}_${statType}`;
}

// This class organizes the business logic for computing the summary statistics to populate
// the summary pane in the data explorer. Initially, I tried to compute everything in
// one big SQL query (which requires a bunch of CTEs to compute histogram bin widths, and a CTE
// for each histogram), but the performance was not good. So this first computes the necessary
// summary statistics (min/max, IQR values, null counts), and then we generate further queries
// to compute histograms, etc. with the computations to compute the bin ids, etc. hard coded.
class ColumnProfileEvaluator {
	private selectedFields: Set<string> = new Set();

	private statsExprs: Set<string> = new Set([alias('COUNT(*)', 'num_rows')]);

	constructor(
		private readonly db: DuckDBInstance,
		private readonly fullSchema: Array<SchemaEntry>,
		private readonly tableName: string,
		private readonly whereClause: string,
		private readonly params: GetColumnProfilesParams
	) { }

	private collectStats(i: number, request: ColumnProfileRequest) {
		const columnSchema = this.fullSchema[request.column_index];
		const fieldName = columnSchema.column_name;
		this.selectedFields.add(quoteIdentifier(fieldName));

		for (const spec of request.profiles) {
			switch (spec.profile_type) {
				case ColumnProfileType.NullCount:
					this.addNullCount(fieldName);
					break;
				case ColumnProfileType.LargeHistogram:
				case ColumnProfileType.SmallHistogram:
					this.addNullCount(fieldName);
					this.addHistogramStats(fieldName, spec.params as ColumnHistogramParams);
					break;
				case ColumnProfileType.LargeFrequencyTable:
				case ColumnProfileType.SmallFrequencyTable:
					// Need the null count to compute the size of the "other" group
					this.addNullCount(fieldName);
					break;
				case ColumnProfileType.SummaryStats:
					this.addSummaryStats(columnSchema);
					break;
				default:
					break;
			}
		}
	}

	private addNullCount(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const statName = statColumnName(fieldName, 'null_count');
		this.statsExprs.add(`COUNT(*) - COUNT(${quotedName}) AS ${quoteIdentifier(statName)}`);
	}

	private addMinMax(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const minName = statColumnName(fieldName, 'min');
		const maxName = statColumnName(fieldName, 'max');
		this.statsExprs.add(`MIN(${quotedName}) AS ${quoteIdentifier(minName)}`);
		this.statsExprs.add(`MAX(${quotedName}) AS ${quoteIdentifier(maxName)}`);
	}

	private addMinMaxStringified(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const minName = statColumnName(fieldName, 'string_min');
		const maxName = statColumnName(fieldName, 'string_max');
		this.statsExprs.add(`MIN(${quotedName})::VARCHAR AS ${quoteIdentifier(minName)}`);
		this.statsExprs.add(`MAX(${quotedName})::VARCHAR AS ${quoteIdentifier(maxName)}`);
	}

	private addNumUnique(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const statName = statColumnName(fieldName, 'nunique');
		this.statsExprs.add(`COUNT(DISTINCT ${quotedName}) AS ${quoteIdentifier(statName)}`);
	}

	private addIqr(fieldName: string) {
		// TODO: This will be imprecise / lossy for out-of-range int64 or decimal values
		const quotedName = quoteIdentifier(fieldName);
		const statName = statColumnName(fieldName, 'iqr');
		this.statsExprs.add(
			`APPROX_QUANTILE(${quotedName}, 0.75)::DOUBLE - APPROX_QUANTILE(${quotedName}, 0.25)::DOUBLE
			AS ${quoteIdentifier(statName)}`
		);
	}

	private addHistogramStats(fieldName: string, params: ColumnHistogramParams) {
		this.addMinMaxStringified(fieldName);
		switch (params.method) {
			case ColumnHistogramParamsMethod.FreedmanDiaconis:
				this.addIqr(fieldName);
				break;
			default:
				// TODO: stats for other methods
				break;
		}
	}

	private addSummaryStats(columnSchema: SchemaEntry) {
		const fieldName = columnSchema.column_name;

		// Quote identifier
		const quotedName = quoteIdentifier(fieldName);
		const getStatName = (statType: string) => statColumnName(fieldName, statType);

		if (isNumeric(columnSchema.column_type)) {
			this.addMinMax(fieldName);
			this.statsExprs.add(`AVG(${quotedName}) AS ${getStatName('mean')}`);
			this.statsExprs.add(`STDDEV_SAMP(${quotedName}) AS ${getStatName('stdev')}`);
			this.statsExprs.add(`MEDIAN(${quotedName}) AS ${getStatName('median')}`);
		} else if (columnSchema.column_type.startsWith('DECIMAL')) {
			this.addMinMaxStringified(fieldName);
			this.statsExprs.add(`AVG(${quotedName})::DOUBLE AS ${getStatName('f64_mean')}`);
			this.statsExprs.add(`STDDEV_SAMP(${quotedName}::DOUBLE) AS ${getStatName('f64_stdev')}`);
			this.statsExprs.add(`MEDIAN(${quotedName}::DOUBLE) AS ${getStatName('f64_median')}`);
		} else if (columnSchema.column_type === 'VARCHAR') {
			this.addNumUnique(fieldName);

			// count strings that are equal to empty string
			this.statsExprs.add(`COUNT(CASE WHEN ${quotedName} = '' THEN 1 END) AS ${getStatName('nempty')}`);
		} else if (columnSchema.column_type === 'BOOLEAN') {
			this.addNullCount(fieldName);
			this.statsExprs.add(`COUNT(CASE WHEN ${quotedName} THEN 1 END) AS ${getStatName('ntrue')}`);
			this.statsExprs.add(`COUNT(CASE WHEN NOT ${quotedName} THEN 1 END) AS ${getStatName('nfalse')}`);
		} else if (columnSchema.column_type === 'TIMESTAMP') {
			this.addMinMaxStringified(fieldName);
			this.addNumUnique(fieldName);
			this.statsExprs.add(`epoch_ms(FLOOR(AVG(epoch_ms(${quotedName})))::BIGINT)::VARCHAR
				AS ${getStatName('string_mean')}`);
			this.statsExprs.add(`epoch_ms(MEDIAN(epoch_ms(${quotedName}))::BIGINT)::VARCHAR
					AS ${getStatName('string_median')}`);
		}
	}

	private async computeFreqTable(columnSchema: SchemaEntry,
		params: ColumnFrequencyTableParams,
		stats: Map<string, any>): Promise<ColumnFrequencyTable> {
		const field = columnSchema.column_name;

		// Quote identifier
		const quotedName = quoteIdentifier(field);

		const predicate = `${quotedName} IS NOT NULL`;
		const composedPred = this.whereClause !== '' ?
			`${this.whereClause} AND ${predicate}` :
			`WHERE ${predicate}`;
		const result = await this.db.runQuery(`
		WITH freq_table AS (
			SELECT ${quotedName} AS value, COUNT(*) AS freq
			FROM ${this.tableName} ${composedPred}
			GROUP BY 1
			LIMIT ${params.limit}
		)
		SELECT value::VARCHAR AS value, freq
		FROM freq_table
		ORDER BY freq DESC, value ASC;`) as Table<any>;

		const values: string[] = [];
		const counts: number[] = [];

		let total = 0;
		for (const row of result.toArray()) {
			values.push(row.value);

			const valueCount = Number(row.freq);
			counts.push(valueCount);
			total += valueCount;
		}

		const numRows = Number(stats.get('num_rows'));
		const nullCount = Number(stats.get(statColumnName(field, 'null_count')));

		return {
			values,
			counts,
			other_count: numRows - total - nullCount
		};
	}

	private async computeHistogram(columnSchema: SchemaEntry, params: ColumnHistogramParams,
		stats: Map<string, any>): Promise<ColumnHistogram> {
		const field = columnSchema.column_name;

		// After everything works, we can work on computing all histograms as a one-shot for
		// potentially better performance
		const numRows = Number(stats.get('num_rows'));

		// If numRows is 0, this is handled earlier

		// TODO: This may be lossy for very large INT64 values
		// We used strings here to temporarily support decimal type data that fits in float64.
		// We will need to return later to support broader-spectrum decimals
		const minValue = Number(stats.get(statColumnName(field, 'string_min')));
		const maxValue = Number(stats.get(statColumnName(field, 'string_max')));

		// Exceptional cases to worry about
		// - Inf/-Inf values in min/max/iqr
		// - NaN values
		const peakToPeak = maxValue - minValue;

		let binWidth = 0;
		switch (params.method) {
			case ColumnHistogramParamsMethod.Fixed: {
				binWidth = peakToPeak / params.num_bins;
				break;
			}
			case ColumnHistogramParamsMethod.FreedmanDiaconis: {
				const iqr = Number(stats.get(statColumnName(field, 'iqr')));
				if (iqr > 0) {
					binWidth = 2 * iqr * Math.pow(numRows, -1 / 3);
				}
				break;
			}
			case ColumnHistogramParamsMethod.Sturges: {
				if (peakToPeak > 0) {
					binWidth = peakToPeak / (Math.log2(numRows) + 1);
				}
				break;
			}
			case ColumnHistogramParamsMethod.Scott:
			default:
				// Not yet implemented
				break;
		}

		const nullCount = Number(stats.get(statColumnName(field, 'null_count')));
		if (nullCount === numRows) {
			return {
				bin_edges: ['NULL', 'NULL'],
				bin_counts: [nullCount],
				quantiles: []
			};
		} else if (binWidth === 0) {
			const predicate = `${quoteIdentifier(field)} IS NOT NULL`;
			const composedPred = this.whereClause !== '' ?
				`${this.whereClause} AND ${predicate}` :
				`WHERE ${predicate}`;
			const result = await this.db.runQuery(`SELECT ${quoteIdentifier(field)}::VARCHAR AS value
			FROM ${this.tableName} ${composedPred} LIMIT 1;`) as Table<any>;

			const fixedValue = result.toArray()[0].value;

			return {
				bin_edges: [fixedValue, fixedValue],
				bin_counts: [numRows - nullCount],
				quantiles: []
			};
		}

		let numBins = Math.ceil(peakToPeak / binWidth);
		// If number of bins from estimate is larger than the number passed by the UI,
		// which is treated as a maximum # of bins, we use the lower number
		if (numBins > params.num_bins) {
			numBins = params.num_bins;
			binWidth = peakToPeak / numBins;
		}

		// For integer types, if the peak-to-peak range is larger than the # bins from the
		// estimator, we use the p-t-p range instead for the number of bins
		if (isInteger(columnSchema.column_type) && peakToPeak <= numBins) {
			numBins = peakToPeak + 1;
			binWidth = peakToPeak / numBins;
		}

		// TODO: Casting to DOUBLE is not safe for BIGINT
		const result = await this.db.runQuery(`
		SELECT FLOOR((${quoteIdentifier(field)}::DOUBLE - ${minValue}) / ${binWidth})::INTEGER AS bin_id,
			COUNT(*) AS bin_count
		FROM ${this.tableName} ${this.whereClause}
		GROUP BY 1;`);

		const output: ColumnHistogram = {
			bin_edges: [],
			bin_counts: [],
			quantiles: []
		};
		const histEntries: Map<number, number> = new Map(
			result.toArray().map(entry => [entry.bin_id, entry.bin_count])
		);
		for (let i = 0; i < numBins; ++i) {
			output.bin_edges.push((minValue + binWidth * i).toString());
			output.bin_counts.push(Number(histEntries.get(i) ?? 0));
		}

		// Since the last bin edge is exclusive, we need to add its count to the last bin
		output.bin_counts[numBins - 1] += Number(histEntries.get(numBins) ?? 0);

		// Compute the push the last bin
		output.bin_edges.push((minValue + binWidth * numBins).toString());
		return output;
	}

	private unboxSummaryStats(
		columnSchema: SchemaEntry,
		stats: Map<string, any>
	): ColumnSummaryStats {
		const fieldName = columnSchema.column_name;
		const getStat = (statType: string) => stats.get(statColumnName(fieldName, statType));

		const formatNumber = (value: number) => {
			value = Number(value);

			if (value - Math.floor(value) === 0) {
				return value.toString();
			}

			if (Math.abs(value) < 1) {
				return value.toFixed(this.params.format_options.small_num_digits);
			} else {
				return value.toFixed(this.params.format_options.large_num_digits);
			}
		};

		if (isNumeric(columnSchema.column_type)) {
			return {
				type_display: ColumnDisplayType.Number,
				number_stats: {
					min_value: formatNumber(getStat('min')),
					max_value: formatNumber(getStat('max')),
					mean: formatNumber(getStat('mean')),
					median: formatNumber(getStat('median')),
					stdev: formatNumber(getStat('stdev')),
				}
			};
		} else if (columnSchema.column_type.startsWith('DECIMAL')) {
			return {
				type_display: ColumnDisplayType.Number,
				number_stats: {
					min_value: getStat('string_min'),
					max_value: getStat('string_max'),
					mean: getStat('f64_mean')?.toString(),
					median: getStat('f64_median')?.toString(),
					stdev: getStat('f64_stdev')?.toString(),
				}
			};
		} else if (columnSchema.column_type === 'VARCHAR') {
			return {
				type_display: ColumnDisplayType.String,
				string_stats: {
					num_unique: Number(getStat('nunique')),
					num_empty: Number(getStat('nempty')),
				}
			};
		} else if (columnSchema.column_type === 'BOOLEAN') {
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: {
					true_count: Number(getStat('ntrue')),
					false_count: Number(getStat('nfalse')),
				}
			};
		} else if (columnSchema.column_type === 'TIMESTAMP') {
			return {
				type_display: ColumnDisplayType.Datetime,
				datetime_stats: {
					min_date: getStat('string_min'),
					max_date: getStat('string_max'),
					mean_date: getStat('string_mean'),
					median_date: getStat('string_median'),
					num_unique: Number(getStat('nunique'))
				}
			};
		} else {
			return {
				type_display: ColumnDisplayType.Unknown
			};
		}
	}

	async evaluate() {
		for (let i = 0; i < this.params.profiles.length; ++i) {
			this.collectStats(i, this.params.profiles[i]);
		}

		// Get all the needed summary statistics
		const statsQuery = `SELECT ${Array.from(this.statsExprs).join(',\n')}
		FROM ${this.tableName}${this.whereClause};`;

		// Table with a single row containing all the computed statistics
		const statsResult = await this.db.runQuery(statsQuery);

		const stats = new Map<string, any>(statsResult.schema.names.map((value, index) => {
			const child = statsResult.getChild(value)!;
			return [value, child.get(0)] as [string, any];
		}));

		const results: Array<ColumnProfileResult> = [];
		for (let i = 0; i < this.params.profiles.length; ++i) {
			const request = this.params.profiles[i];

			const columnSchema = this.fullSchema[request.column_index];
			const field = columnSchema.column_name;

			// const numRows = Number(stats.get('num_rows'));

			const result: ColumnProfileResult = {};
			for (const spec of request.profiles) {
				switch (spec.profile_type) {
					case ColumnProfileType.NullCount:
						result.null_count = Number(stats.get(statColumnName(field, 'null_count')));
						break;
					case ColumnProfileType.LargeHistogram:
					case ColumnProfileType.SmallHistogram:
						result[spec.profile_type] = await this.computeHistogram(
							columnSchema, spec.params as ColumnHistogramParams, stats
						);
						break;
					case ColumnProfileType.LargeFrequencyTable:
					case ColumnProfileType.SmallFrequencyTable:
						result[spec.profile_type] = await this.computeFreqTable(
							columnSchema, spec.params as ColumnFrequencyTableParams, stats
						);
						break;
					case ColumnProfileType.SummaryStats:
						result.summary_stats = this.unboxSummaryStats(columnSchema, stats);
						break;
					default:
						break;
				}
			}
			results.push(result);
		}

		return results;
	}
}

function isInteger(duckdbName: string) {
	switch (duckdbName) {
		case 'TINYINT':
		case 'SMALLINT':
		case 'INTEGER':
		case 'BIGINT':
			return true;
		default:
			return false;
	}
}

function isNumeric(duckdbName: string) {
	return (
		isInteger(duckdbName) ||
		duckdbName === 'FLOAT' ||
		duckdbName === 'DOUBLE'
	);
}

/**
 * Interface for serving data explorer requests for a particular table in DuckDB
 */
export class DuckDBTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];
	private columnFilters: Array<ColumnFilter> = [];

	private _unfilteredShape: Promise<[number, number]>;
	private _filteredShape: Promise<[number, number]>;

	private _sortClause: string = '';
	private _whereClause: string = '';

	constructor(
		readonly uri: vscode.Uri,
		private tableName: string,
		private fullSchema: Array<SchemaEntry>,
		readonly db: DuckDBInstance,
		readonly isConnected: boolean = true,
		readonly errorMessage: string = ''
	) {
		if (isConnected) {
			this._unfilteredShape = this._getShape();
		} else {
			this._unfilteredShape = Promise.resolve([0, 0]);
		}
		this._filteredShape = this._unfilteredShape;
	}

	async onFileUpdated(newTableName: string, newSchema: Array<SchemaEntry>) {
		if (!this.isConnected) {
			return;
		}

		this.tableName = newTableName;
		this.fullSchema = newSchema;

		this._unfilteredShape = this._getShape();

		// Need to re-apply the row filters, if any
		await this._applyRowFilters();

		// When the file changes, refuse to guess and send SchemaUpdate event
		return vscode.commands.executeCommand(
			'positron-data-explorer.sendUiEvent', {
				uri: this.uri.toString(),
				method: DataExplorerFrontendEvent.SchemaUpdate,
				params: {}
			} satisfies DataExplorerUiEvent
		);
	}

	static getDisconnected(uri: vscode.Uri, errorMessage: string, db: DuckDBInstance) {
		return new DuckDBTableView(uri, 'disconnected', [], db, false, errorMessage);
	}

	async getSchema(params: GetSchemaParams): RpcResponse<TableSchema> {
		return {
			columns: params.column_indices.map((index) => {
				const entry = this.fullSchema[index];
				let type_display = SCHEMA_TYPE_MAPPING.get(entry.column_type);
				if (type_display === undefined) {
					type_display = ColumnDisplayType.Unknown;
				}

				// If entry.column_type is like DECIMAL($p,$s), set type_display to Number
				if (entry.column_type.startsWith('DECIMAL')) {
					type_display = ColumnDisplayType.Number;
				}

				return {
					column_name: entry.column_name,
					column_index: index,
					type_name: entry.column_type,
					type_display,
				};
			}),
		};
	}

	async searchSchema(
		params: SearchSchemaParams,
	): RpcResponse<SearchSchemaResult> {
		// Get all column indices
		const allIndices: number[] = [];
		for (let i = 0; i < this.fullSchema.length; i++) {
			allIndices.push(i);
		}

		// Apply filters if any
		let filteredIndices = allIndices;
		if (params.filters && params.filters.length > 0) {
			filteredIndices = allIndices.filter((index) => {
				const entry = this.fullSchema[index];
				const columnName = entry.column_name;
				const columnType = entry.column_type;

				// Get display type for this column
				let displayType = SCHEMA_TYPE_MAPPING.get(columnType);
				if (displayType === undefined) {
					displayType = ColumnDisplayType.Unknown;
				}
				if (columnType.startsWith('DECIMAL')) {
					displayType = ColumnDisplayType.Number;
				}

				// Apply each filter
				return params.filters.every((filter) => {
					switch (filter.filter_type) {
						case ColumnFilterType.TextSearch: {
							const textFilter =
								filter.params as FilterTextSearch;
							const searchTerm = textFilter.case_sensitive
								? textFilter.term
								: textFilter.term.toLowerCase();
							const columnNameToMatch = textFilter.case_sensitive
								? columnName
								: columnName.toLowerCase();

							switch (textFilter.search_type) {
								case TextSearchType.Contains:
									return columnNameToMatch.includes(
										searchTerm,
									);
								case TextSearchType.NotContains:
									return !columnNameToMatch.includes(
										searchTerm,
									);
								case TextSearchType.StartsWith:
									return columnNameToMatch.startsWith(
										searchTerm,
									);
								case TextSearchType.EndsWith:
									return columnNameToMatch.endsWith(
										searchTerm,
									);
								case TextSearchType.RegexMatch:
									try {
										const regex = new RegExp(
											textFilter.term,
											textFilter.case_sensitive
												? ''
												: 'i',
										);
										return regex.test(columnName);
									} catch {
										return false;
									}
								default:
									return false;
							}
						}
						case ColumnFilterType.MatchDataTypes: {
							const typeFilter =
								filter.params as FilterMatchDataTypes;
							return typeFilter.display_types.includes(
								displayType,
							);
						}
						default:
							return false;
					}
				});
			});
		}

		// Sort the filtered indices
		switch (params.sort_order) {
			case SearchSchemaSortOrder.Ascending:
				filteredIndices.sort((a, b) => {
					const nameA = this.fullSchema[a].column_name.toLowerCase();
					const nameB = this.fullSchema[b].column_name.toLowerCase();
					return nameA.localeCompare(nameB);
				});
				break;
			case SearchSchemaSortOrder.Descending:
				filteredIndices.sort((a, b) => {
					const nameA = this.fullSchema[a].column_name.toLowerCase();
					const nameB = this.fullSchema[b].column_name.toLowerCase();
					return nameB.localeCompare(nameA);
				});
				break;
			case SearchSchemaSortOrder.Original:
			default:
				// Keep original order
				break;
		}

		return {
			matches: filteredIndices,
		};
	}

	async getDataValues(params: GetDataValuesParams): RpcResponse<TableData> {
		// Because DuckDB is a SQL engine, we opt to always select a row range of
		// formatted data for a range of rows, and then return the requested selections
		// based on what the UI requested. This blunt approach could end up being wasteful in
		// some cases, but doing fewer queries / scans in the average case should yield better
		// performance.

		// First, check if the filtered table has any rows at all
		const [filteredNumRows, _] = await this._filteredShape;
		if (filteredNumRows === 0) {
			// If the table has 0 rows due to filtering, return empty columns immediately
			return {
				columns: Array.from({ length: params.columns.length }, () => [])
			};
		}

		let lowerLimit = Infinity;
		let upperLimit = -Infinity;

		const smallNumDigits = params.format_options.small_num_digits;
		const largeNumDigits = params.format_options.large_num_digits;

		const thousandsSep = params.format_options.thousands_sep;
		const sciNotationLimit = '1' + '0'.repeat(params.format_options.max_integral_digits);
		const varcharLimit = params.format_options.max_value_length;

		let smallFloatFormat, largeFloatFormat;
		if (thousandsSep) {
			largeFloatFormat = `'{:,.${largeNumDigits}f}'`;
			smallFloatFormat = `'{:,.${smallNumDigits}f}'`;
		} else {
			largeFloatFormat = `'{:.${largeNumDigits}f}'`;
			smallFloatFormat = `'{:.${smallNumDigits}f}'`;
		}

		const columnSelectors = [];
		const selectedColumns = [];
		for (const column of params.columns) {
			if ('first_index' in column.spec) {
				// Value range
				lowerLimit = Math.min(lowerLimit, column.spec.first_index);
				upperLimit = Math.max(upperLimit, column.spec.last_index);
			} else {
				// Set of values indices, just get the lower and upper extent
				lowerLimit = Math.min(lowerLimit, ...column.spec.indices);
				upperLimit = Math.max(upperLimit, ...column.spec.indices);
			}

			const columnSchema = this.fullSchema[column.column_index];
			const quotedName = quoteIdentifier(columnSchema.column_name);

			const smallRounded = `ROUND(${quotedName}, ${smallNumDigits})`;
			const largeRounded = `ROUND(${quotedName}, ${largeNumDigits})`;

			// TODO: what is column_index is out of bounds?

			// Build column selector. Just casting to string for now
			let columnSelector;
			switch (columnSchema.column_type) {
				case 'TINYINT':
				case 'SMALLINT':
				case 'INTEGER':
				case 'BIGINT':
					if (thousandsSep && thousandsSep !== undefined) {
						columnSelector = `FORMAT('{:,}', ${quotedName})`;
						if (thousandsSep !== ',') {
							columnSelector = `REPLACE(${columnSelector}, ',', '${thousandsSep}')`;
						}
					} else {
						columnSelector = `FORMAT('{:d}', ${quotedName})`;
					}
					break;
				case 'FLOAT':
				case 'DOUBLE': {
					let largeFormatter = `FORMAT(${largeFloatFormat}, ${largeRounded})`;
					let smallFormatter = `FORMAT(${smallFloatFormat}, ${smallRounded})`;
					if (thousandsSep && thousandsSep !== ',') {
						largeFormatter = `REPLACE(${largeFormatter}, ',', '${thousandsSep}')`;
						smallFormatter = `REPLACE(${smallFormatter}, ',', '${thousandsSep}')`;
					}
					columnSelector = `CASE WHEN ${quotedName} IS NULL THEN 'NULL'
WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
WHEN isinf(${quotedName}) AND ${quotedName} < 0 THEN '-Inf'
WHEN isnan(${quotedName}) THEN 'NaN'
WHEN abs(${quotedName}) >= ${sciNotationLimit} THEN FORMAT('{:.${largeNumDigits}e}', ${quotedName})
WHEN abs(${quotedName}) < 1 AND abs(${quotedName}) > 0 THEN ${smallFormatter}
ELSE ${largeFormatter}
END`;
					break;
				}
				case 'VARCHAR':
					columnSelector = `SUBSTRING(${quotedName}, 1, ${varcharLimit})`;
					break;
				case 'TIMESTAMP':
					columnSelector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
					break;
				default:
					columnSelector = `CAST(${quotedName} AS VARCHAR)`;
					break;
			}
			selectedColumns.push(quotedName);
			columnSelectors.push(`${columnSelector} AS formatted_${columnSelectors.length} `);
		}

		let numRows = 0;
		if (isFinite(lowerLimit) && isFinite(upperLimit)) {
			// Limits are inclusive
			numRows = upperLimit - lowerLimit + 1;
		}

		// No column selectors case, do not error if we get a request like this
		if (columnSelectors.length === 0) {
			return { columns: [] };
		} else if (numRows === 0) {
			return {
				columns: Array.from({ length: params.columns.length }, () => [])
			};
		}

		// For some reason, DuckDB performs better if you do your sort/limit/offset in a subquery
		// and then format that small selection.
		const query = `SELECT\n${columnSelectors.join(',\n    ')}
		FROM (
			SELECT ${selectedColumns.join(', ')} FROM
			${this.tableName}${this._whereClause}${this._sortClause}
			LIMIT ${numRows}
			OFFSET ${lowerLimit}
		) t;`;

		const queryResult = await this.db.runQuery(query);

		// Sanity check
		if (queryResult.numCols !== params.columns.length) {
			throw new Error('Incorrect number of columns in query result');
		}

		const result: TableData = {
			columns: []
		};

		const floatAdapter = (field: Vector<any>, i: number) => {
			const value: string = field.get(i - lowerLimit);
			switch (value) {
				case 'NaN':
					return SENTINEL_NAN;
				case 'NULL':
					return SENTINEL_NULL;
				case 'Inf':
					return SENTINEL_INF;
				case '-Inf':
					return SENTINEL_NEGINF;
				default:
					return value;
			}
		};

		const defaultAdapter = (field: Vector<any>, i: number) => {
			const relIndex = i - lowerLimit;
			return field.isValid(relIndex) ? field.get(relIndex) : SENTINEL_NULL;
		};

		for (let i = 0; i < queryResult.numCols; i++) {
			const column = params.columns[i];
			const spec = column.spec;
			const field = queryResult.getChildAt(i)!;

			const fetchValues = (adapter: (field: Vector<any>, i: number) => ColumnValue) => {
				if ('first_index' in spec) {
					// There may be fewer rows available than what was requested
					const lastIndex = Math.min(
						spec.last_index,
						spec.first_index + queryResult.numRows - 1
					);

					const columnValues: Array<string | number> = [];
					// Value range, we need to extract the actual slice requested
					for (let i = spec.first_index; i <= lastIndex; ++i) {
						columnValues.push(adapter(field, i));
					}
					return columnValues;
				} else {
					// Set of values indices, just get the lower and upper extent
					return spec.indices.map((i) => adapter(field, i));
				}
			};

			const columnSchema = this.fullSchema[column.column_index];
			switch (columnSchema.column_type) {
				case 'DOUBLE':
				case 'FLOAT':
					result.columns.push(fetchValues(floatAdapter));
					break;
				default:
					result.columns.push(fetchValues(defaultAdapter));
					break;
			}

		}

		return result;
	}

	async getRowLabels(params: GetRowLabelsParams): RpcResponse<TableRowLabels> {
		return 'not implemented';
	}

	private getDisconnectedState(): BackendState {
		return {
			display_name: this.uri.path,
			connected: false,
			error_message: this.errorMessage,
			table_shape: { num_rows: 0, num_columns: 0 },
			table_unfiltered_shape: { num_rows: 0, num_columns: 0 },
			has_row_labels: false,
			column_filters: [],
			row_filters: [],
			sort_keys: [],
			supported_features: {
				search_schema: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_column_filters: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_row_filters: {
					support_status: SupportStatus.Unsupported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: []
				},
				get_column_profiles: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_sort_columns: { support_status: SupportStatus.Unsupported, },
				export_data_selection: {
					support_status: SupportStatus.Unsupported,
					supported_formats: []
				},
				convert_to_code: {
					support_status: SupportStatus.Unsupported,
				}
			}
		};

	}

	async getState(): RpcResponse<BackendState> {
		if (!this.isConnected) {
			return this.getDisconnectedState();
		}

		const [unfiltedNumRows, unfilteredNumCols] = await this._unfilteredShape;
		const [filteredNumRows, filteredNumCols] = await this._filteredShape;
		return {
			display_name: path.basename(this.uri.path),
			table_shape: {
				num_rows: filteredNumRows,
				num_columns: filteredNumCols
			},
			table_unfiltered_shape: {
				num_rows: unfiltedNumRows,
				num_columns: unfilteredNumCols
			},
			has_row_labels: false,
			column_filters: this.columnFilters,
			row_filters: this.rowFilters,
			sort_keys: this.sortKeys,
			supported_features: {
				get_column_profiles: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{
							profile_type: ColumnProfileType.NullCount,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.SummaryStats,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.SmallFrequencyTable,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.LargeFrequencyTable,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.SmallHistogram,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.LargeHistogram,
							support_status: SupportStatus.Supported
						}
					]
				},
				search_schema: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{
							column_filter_type: ColumnFilterType.TextSearch,
							support_status: SupportStatus.Supported,
						},
						{
							column_filter_type: ColumnFilterType.MatchDataTypes,
							support_status: SupportStatus.Supported,
						}
					],
				},
				set_column_filters: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_row_filters: {
					support_status: SupportStatus.Supported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: [
						{
							row_filter_type: RowFilterType.Between,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.Compare,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsEmpty,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsFalse,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsNull,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsTrue,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.NotBetween,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.NotEmpty,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.NotNull,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.Search,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.SetMembership,
							support_status: SupportStatus.Supported
						}
					]
				},
				set_sort_columns: { support_status: SupportStatus.Supported, },
				export_data_selection: {
					support_status: SupportStatus.Supported,
					supported_formats: [
						ExportFormat.Csv,
						ExportFormat.Tsv,
						ExportFormat.Html
					]
				},
				convert_to_code: {
					support_status: SupportStatus.Unsupported,
				}
			}
		};
	}

	async getColumnProfiles(params: GetColumnProfilesParams): RpcResponse<void> {
		// Initiate but do not await profile evaluations
		this._evaluateColumnProfiles(params);
	}

	/**
	 * Creates empty summary statistics for a column when there are zero rows
	 * @param columnSchema Column schema information
	 * @returns Empty summary stats appropriate for the column type
	 */
	private createEmptySummaryStats(columnSchema: SchemaEntry): ColumnSummaryStats {
		if (isNumeric(columnSchema.column_type) || columnSchema.column_type.startsWith('DECIMAL')) {
			return {
				type_display: ColumnDisplayType.Number,
				number_stats: {}
			};
		} else if (columnSchema.column_type === 'VARCHAR') {
			return {
				type_display: ColumnDisplayType.String,
				string_stats: {
					num_unique: 0,
					num_empty: 0
				}
			};
		} else if (columnSchema.column_type === 'BOOLEAN') {
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: {
					true_count: 0,
					false_count: 0
				}
			};
		} else if (columnSchema.column_type === 'TIMESTAMP') {
			return {
				type_display: ColumnDisplayType.Datetime,
				datetime_stats: {
					num_unique: 0
				}
			};
		} else {
			return {
				type_display: ColumnDisplayType.Unknown
			};
		}
	}

	private async _evaluateColumnProfiles(params: GetColumnProfilesParams) {
		// Check if there are any rows in the filtered data
		const [filteredRowCount, _] = await this._filteredShape;

		const outParams: ReturnColumnProfilesEvent = {
			callback_id: params.callback_id,
			profiles: []
		};

		if (filteredRowCount === 0) {
			// Handle the zero-row case - return empty/null profiles
			outParams.profiles = params.profiles.map(request => {
				// Create an empty result with appropriate null values
				const result: ColumnProfileResult = {};

				for (const spec of request.profiles) {
					switch (spec.profile_type) {
						case ColumnProfileType.NullCount:
							result.null_count = 0;
							break;
						case ColumnProfileType.LargeHistogram:
						case ColumnProfileType.SmallHistogram:
							result[spec.profile_type] = {
								bin_edges: ['NULL', 'NULL'],
								bin_counts: [0],
								quantiles: []
							};
							break;
						case ColumnProfileType.LargeFrequencyTable:
						case ColumnProfileType.SmallFrequencyTable:
							result[spec.profile_type] = {
								values: [],
								counts: [],
								other_count: 0
							};
							break;
						case ColumnProfileType.SummaryStats:
							// Create null summary stats appropriate for the column type
							const columnSchema = this.fullSchema[request.column_index];
							result.summary_stats = this.createEmptySummaryStats(columnSchema);
							break;
					}
				}
				return result;
			});
		} else {
			// Normal case - compute stats using evaluator
			const evaluator = new ColumnProfileEvaluator(this.db,
				this.fullSchema,
				this.tableName,
				this._whereClause,
				params
			);

			try {
				outParams.profiles = await evaluator.evaluate();
			} catch (error) {
				// TODO: Add error message to ReturnColumnProfilesEvent and display in UI
				const errorMessage = error instanceof Error ? error.message : 'unknown error';
				console.log(`Failed to compute column profiles: ${errorMessage}`);
			}
		}

		await vscode.commands.executeCommand(
			'positron-data-explorer.sendUiEvent', {
				uri: this.uri.toString(),
				method: DataExplorerFrontendEvent.ReturnColumnProfiles,
				params: outParams
			} satisfies DataExplorerUiEvent
		);
	}

	async setRowFilters(params: SetRowFiltersParams): RpcResponse<FilterResult> {
		this.rowFilters = params.filters;
		await this._applyRowFilters();
		const newShape = await this._filteredShape;
		return { selected_num_rows: newShape[0] };
	}

	private async _applyRowFilters() {
		if (this.rowFilters.length === 0) {
			this._whereClause = '';
			const unfilteredShape = await this._unfilteredShape;

			// reset filtered shape
			this._filteredShape = this._unfilteredShape;

			return { selected_num_rows: unfilteredShape[0] };
		}

		const whereExprs = this.rowFilters.map(makeWhereExpr);
		this._whereClause = `\nWHERE ${whereExprs.join(' AND ')}`;
		this._filteredShape = this._getShape(this._whereClause);
	}

	async setSortColumns(params: SetSortColumnsParams): RpcResponse<void> {
		this.sortKeys = params.sort_keys;
		if (this.sortKeys.length === 0) {
			this._sortClause = '';
			return;
		}

		const sortExprs = [];
		for (const sortKey of this.sortKeys) {
			const columnSchema = this.fullSchema[sortKey.column_index];
			const quotedName = quoteIdentifier(columnSchema.column_name);
			const modifier = sortKey.ascending ? '' : ' DESC';
			sortExprs.push(`${quotedName}${modifier}`);
		}

		this._sortClause = `\nORDER BY ${sortExprs.join(', ')}`;
	}

	async exportDataSelection(params: ExportDataSelectionParams): RpcResponse<ExportedData> {
		const kind = params.selection.kind;

		const exportQueryOutput = async (query: string,
			columns: Array<SchemaEntry>): Promise<ExportedData> => {
			const result = await this.db.runQuery(query);
			const unboxed = [
				columns.map(s => s.column_name),
				// TODO: maybe this can be made more efficient
				...result.toArray().map(row => result.schema.names.map(name => row[name]))
			];

			let data;
			switch (params.format) {
				case ExportFormat.Csv:
					data = unboxed.map(row => row.join(',')).join('\n');
					break;
				case ExportFormat.Tsv:
					data = unboxed.map(row => row.join('\t')).join('\n');
					break;
				case ExportFormat.Html:
					data = unboxed.map(row => `<tr><td>${row.join('</td><td>')}</td></tr>`).join('\n');
					break;
				default:
					throw new Error(`Unknown export format: ${params.format}`);
			}

			return {
				data,
				format: params.format,
			};
		};

		const getColumnSelectors = (columns: Array<SchemaEntry>) => {
			const columnSelectors = [];
			for (const column of columns) {
				const quotedName = quoteIdentifier(column.column_name);

				// Build column selector. Just casting to string for now
				let columnSelector;
				switch (column.column_type) {
					case 'FLOAT':
					case 'DOUBLE': {
						columnSelector = `CASE WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
	WHEN isinf(${quotedName}) AND ${quotedName} < 0 THEN '-Inf'
	WHEN isnan(${quotedName}) THEN 'NaN'
	ELSE CAST(${quotedName} AS VARCHAR)
	END`;
						break;
					}
					case 'TIMESTAMP':
						columnSelector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
						break;
					case 'TIMESTAMP WITH TIME ZONE':
						columnSelector = `strftime(${quotedName}, '%Y-%m-%d %H:%M:%S%z')`;
						break;
					case 'VARCHAR':
					case 'TINYINT':
					case 'SMALLINT':
					case 'INTEGER':
					case 'BIGINT':
					case 'DATE':
					case 'TIME':
					default:
						columnSelector = `CAST(${quotedName} AS VARCHAR)`;
						break;
				}
				columnSelectors.push(
					`CASE WHEN ${quotedName} IS NULL THEN 'NULL' ELSE ${columnSelector} END
					AS formatted_${columnSelectors.length} `);
			}
			return columnSelectors;
		};

		let data: string;
		switch (kind) {
			case TableSelectionKind.SingleCell: {
				const selection = params.selection.selection as DataSelectionSingleCell;
				const rowIndex = selection.row_index;
				const columnIndex = selection.column_index;
				const schema = this.fullSchema[columnIndex];
				const selector = getColumnSelectors([schema])[0];
				const query = `SELECT ${selector} FROM ${this.tableName} LIMIT 1 OFFSET ${rowIndex};`;
				const result = await this.db.runQuery(query);
				return {
					data: result.toArray()[0][result.schema.names[0]],
					format: params.format
				};
			}
			case TableSelectionKind.CellRange: {
				const selection = params.selection.selection as DataSelectionCellRange;
				const rowStart = selection.first_row_index;
				const rowEnd = selection.last_row_index;
				const columnStart = selection.first_column_index;
				const columnEnd = selection.last_column_index;
				const columns = this.fullSchema.slice(columnStart, columnEnd + 1);
				const query = `SELECT ${getColumnSelectors(columns).join(',')}
				FROM ${this.tableName}
				LIMIT ${rowEnd - rowStart + 1} OFFSET ${rowStart};`;
				return await exportQueryOutput(query, columns);
			}
			case TableSelectionKind.RowRange: {
				const selection = params.selection.selection as DataSelectionRange;
				const rowStart = selection.first_index;
				const rowEnd = selection.last_index;
				const query = `SELECT ${getColumnSelectors(this.fullSchema).join(',')}
				FROM ${this.tableName}
				LIMIT ${rowEnd - rowStart + 1} OFFSET ${rowStart};`;
				return await exportQueryOutput(query, this.fullSchema);
			}
			case TableSelectionKind.ColumnRange: {
				const selection = params.selection.selection as DataSelectionRange;
				const columnStart = selection.first_index;
				const columnEnd = selection.last_index;
				const columns = this.fullSchema.slice(columnStart, columnEnd + 1);
				const query = `SELECT ${getColumnSelectors(columns).join(',')}
				FROM ${this.tableName}`;
				return await exportQueryOutput(query, columns);
			}
			case TableSelectionKind.RowIndices: {
				const selection = params.selection.selection as DataSelectionIndices;
				const indices = selection.indices;
				const query = `SELECT ${getColumnSelectors(this.fullSchema).join(',')}
				FROM ${this.tableName}
				WHERE rowid IN (${indices.join(', ')})`;
				return await exportQueryOutput(query, this.fullSchema);
			}
			case TableSelectionKind.ColumnIndices: {
				const selection = params.selection.selection as DataSelectionIndices;
				const indices = selection.indices;
				const columns = indices.map(i => this.fullSchema[i]);
				const query = `SELECT ${getColumnSelectors(columns).join(',')}
				FROM ${this.tableName}`;
				return await exportQueryOutput(query, columns);
			}
		}
	}
	private async _getShape(whereClause: string = ''): Promise<[number, number]> {
		const numColumns = this.fullSchema.length;
		const countStar = `SELECT count(*) AS num_rows
		FROM ${this.tableName}
		${whereClause};`;

		const result = await this.db.runQuery(countStar);
		// The count comes back as BigInt
		const numRows = Number(result.toArray()[0].num_rows);
		return [numRows, numColumns];
	}
}

/**
 * Implementation of Data Explorer backend protocol using duckdb-wasm,
 * for serving requests coming in through the vscode command.
 */
export class DataExplorerRpcHandler implements vscode.Disposable {
	private readonly _uriToTableView = new Map<string, DuckDBTableView>();
	private _tableIndex: number = 0;
	private _watchers: vscode.Disposable[] = [];

	constructor(private readonly db: DuckDBInstance) { }

	dispose() {
		vscode.Disposable.from(...this._watchers).dispose();
	}

	async openDataset(params: OpenDatasetParams): Promise<OpenDatasetResult> {
		let scanQuery, tableName;
		const uri = vscode.Uri.parse(params.uri);
		if (uri.scheme === 'duckdb') {
			// We are querying a table in the transient in-memory database. We can modify this later
			// to read from different .duckb database files
			tableName = uri.path;
		} else {
			tableName = `positron_${this._tableIndex++}`;
			await this.createTableFromUri(uri, tableName);
		}

		let tableView: DuckDBTableView;
		try {
			const result = await this.db.runQuery(`DESCRIBE ${tableName};`);
			tableView = new DuckDBTableView(uri, tableName, result.toArray(), this.db);

			if (uri.scheme !== 'duckdb') {
				// Watch file for changes.
				const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, '*'), true);
				watcher.onDidChange(async () => {
					const newTableName = `positron_${this._tableIndex++}`;

					await this.createTableFromUri(uri, newTableName);

					const newSchema = (await this.db.runQuery(`DESCRIBE ${newTableName};`)).toArray();
					await tableView.onFileUpdated(newTableName, newSchema);
				});
				// Stop watching deleted files.
				watcher.onDidDelete(() => watcher.dispose());
				this._watchers.push(watcher);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ?
				error.message : 'Unable to open for unknown reason';
			tableView = DuckDBTableView.getDisconnected(uri, errorMessage, this.db);

		}
		this._uriToTableView.set(params.uri.toString(), tableView);
		return {};
	}

	/**
	 * Import data file into DuckDB by creating table or view
	 * @param uri A URI, usually for a file path on disk.
	 * @param catalogName The table name to use in the DuckDB catalog.
	 */
	async createTableFromUri(uri: vscode.Uri, catalogName: string) {
		let fileExt = path.extname(uri.path);
		const isGzipped = fileExt === '.gz';

		if (isGzipped) {
			fileExt = path.extname(uri.path.slice(0, -3));
		}

		const getCsvImportQuery = (_filePath: string, options: Array<String>) => {
			return `CREATE OR REPLACE TABLE ${catalogName} AS
			SELECT * FROM read_csv_auto('${_filePath}'${options.length ? ', ' : ''}${options.join(' ,')});`;
		};

		const importDelimited = async (filePath: string, catalogType: string = 'TABLE',
			extraParams: string = '') => {
			// TODO: Will need to be able to pass CSV / TSV options from the
			// UI at some point.
			const options: Array<string> = [];
			if (fileExt === '.tsv') {
				options.push('delim=\'\t\'');
			} else if (fileExt !== '.csv' && fileExt !== '.tsv') {
				throw new Error(`Unsupported file extension: ${fileExt}`);
			}

			let query = getCsvImportQuery(filePath, options);
			try {
				await this.db.runQuery(query);
			} catch (error) {
				// Retry with sample_size=-1 to disable sampling if type inference fails
				options.push('sample_size=-1');
				query = getCsvImportQuery(filePath, options);
				await this.db.runQuery(query);
			}
		};

		// Read the entire contents and register it as a temp file
		// to avoid file handle caching in duckdb-wasm
		let fileContents = await vscode.workspace.fs.readFile(uri);
		if (isGzipped) {
			fileContents = zlib.gunzipSync(fileContents);
		}

		// For gzipped files, use the base name without the .gz extension
		const virtualPath = isGzipped ?
			path.basename(uri.path, '.gz') :
			path.basename(uri.path);

		// Use a tightly packed Uint8Array to avoid transfer issues
		const fileBuffer = new Uint8Array(fileContents.buffer.slice(fileContents.byteOffset, fileContents.byteOffset + fileContents.byteLength));
		await this.db.db.registerFileBuffer(virtualPath, fileBuffer);
		try {
			const baseExt = path.extname(virtualPath);
			if (baseExt === '.parquet' || baseExt === '.parq') {
				// Always create a view for Parquet files
				const query = `CREATE OR REPLACE TABLE ${catalogName} AS
				SELECT * FROM parquet_scan('${virtualPath}');`;
				await this.db.runQuery(query);
			} else {
				await importDelimited(virtualPath);
			}
		} finally {
			await this.db.db.dropFile(virtualPath);
		}
	}

	async handleRequest(rpc: DataExplorerRpc): Promise<DataExplorerResponse> {
		try {
			return { result: await this._dispatchRpc(rpc) };
		} catch (error) {
			if (error instanceof Error) {
				return { error_message: error.message };
			} else {
				return { error_message: `Unknown data explorer RPC error with with ${rpc.method}` };
			}
		}
	}

	private async _dispatchRpc(rpc: DataExplorerRpc): RpcResponse<any> {
		if (rpc.method === DataExplorerBackendRequest.OpenDataset) {
			return this.openDataset(rpc.params as OpenDatasetParams);
		}

		if (rpc.uri === undefined) {
			return `URI for open dataset must be provided: ${rpc.method} `;
		}
		const table = this._uriToTableView.get(rpc.uri.toString()) as DuckDBTableView;
		switch (rpc.method) {
			case DataExplorerBackendRequest.ExportDataSelection:
				return table.exportDataSelection(rpc.params as ExportDataSelectionParams);
			case DataExplorerBackendRequest.GetColumnProfiles:
				return table.getColumnProfiles(rpc.params as GetColumnProfilesParams);
			case DataExplorerBackendRequest.GetDataValues:
				return table.getDataValues(rpc.params as GetDataValuesParams);
			case DataExplorerBackendRequest.GetRowLabels:
				return table.getRowLabels(rpc.params as GetRowLabelsParams);
			case DataExplorerBackendRequest.GetSchema:
				return table.getSchema(rpc.params as GetSchemaParams);
			case DataExplorerBackendRequest.GetState:
				return table.getState();
			case DataExplorerBackendRequest.SetRowFilters:
				return table.setRowFilters(rpc.params as SetRowFiltersParams);
			case DataExplorerBackendRequest.SetSortColumns:
				return table.setSortColumns(rpc.params as SetSortColumnsParams);
			case DataExplorerBackendRequest.SetColumnFilters:
			case DataExplorerBackendRequest.SearchSchema:
				return `${rpc.method} not yet implemented`;
			default:
				return `unrecognized data explorer method: ${rpc.method} `;
		}
	}
}

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extension context.
 */
export async function activate(context: vscode.ExtensionContext) {
	// Register a simple command that runs a DuckDB-Wasm query
	const db = await DuckDBInstance.create(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('positron-duckdb.runQuery',
			async (query: string) => {
				const result = await db.runQuery(query);
				if (typeof result === 'string') {
					console.error('DuckDB error:', result);
				} else {
					return result.toArray();
				}
			})
	);

	const dataExplorerHandler = new DataExplorerRpcHandler(db);
	context.subscriptions.push(
		dataExplorerHandler,
		vscode.commands.registerCommand('positron-duckdb.dataExplorerRpc',
			async (rpc: DataExplorerRpc): Promise<DataExplorerResponse> => {
				return dataExplorerHandler.handleRequest(rpc);
			})
	);
}

export function deactivate() { }
