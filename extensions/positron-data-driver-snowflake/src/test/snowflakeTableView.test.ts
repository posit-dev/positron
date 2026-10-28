/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ColumnDisplayType, ColumnHistogramParamsMethod, ColumnProfileType, ColumnSchema, ExportFormat, FilterComparisonOp, FormatOptions, RowFilter, RowFilterCondition, RowFilterType, TableSelectionKind, TextSearchType } from 'positron-data-explorer-protocol';
import { ISnowflakeQueryClient, makeWhereExpr, SnowflakeSchemaEntry, SnowflakeTableView } from '../snowflakeTableView.js';

// Minimal format options; only the numeric-summary path reads them.
const FORMAT_OPTIONS: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
	thousands_sep: undefined,
};

// A query client that records the SQL it runs and answers from a substring-matched handler. The
// recorded list lets a test assert how many round-trips a profile pass costs.
function recordingClient(handler: (sql: string) => Array<Record<string, unknown>>) {
	const queries: string[] = [];
	const client: ISnowflakeQueryClient = {
		runQuery: async (sql: string) => {
			queries.push(sql);
			return handler(sql);
		},
	};
	return { client, queries };
}

function entry(column_name: string, type_display: ColumnDisplayType): SnowflakeSchemaEntry {
	return { column_name, column_type: 'x', type_display };
}

suite('Snowflake Column Profiles', () => {

	test('batches null counts for every column into a single scan', async () => {
		const schema = [
			entry('a', ColumnDisplayType.Integer),
			entry('b', ColumnDisplayType.String),
			entry('c', ColumnDisplayType.Integer),
		];
		const { client, queries } = recordingClient((sql) => {
			// The constructor's row count.
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 300000 }];
			}
			// The batched scalar-aggregate query: total plus per-column non-null counts.
			return [{ agg_total: 300000, agg_nn_0: 300000, agg_nn_1: 299000, agg_nn_2: 250000 }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."flights"', 'flights', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: schema.map((_, column_index) => ({
				column_index,
				profiles: [{ profile_type: ColumnProfileType.NullCount }],
			})),
		});

		// One constructor count query + exactly one batched scalar query for all three columns.
		assert.strictEqual(queries.length, 2);
		assert.deepStrictEqual(profiles.map(p => p.null_count), [0, 1000, 50000]);
	});

	test('folds numeric summary stats and the median into the single scalar query', async () => {
		const schema = [entry('n', ColumnDisplayType.Integer)];
		const { client, queries } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 4 }];
			}
			// The batched scalar query, including the median folded in as an ordered-set aggregate.
			return [{ agg_total: 4, agg_nn_0: 4, agg_n_0: 4, agg_lo_0: 10, agg_hi_0: 40, agg_s_0: 100, agg_ss_0: 3000, agg_med_0: 20 }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [{ profile_type: ColumnProfileType.NullCount }, { profile_type: ColumnProfileType.SummaryStats }],
			}],
		});

		// Constructor count + one scalar query; the median no longer costs a separate round-trip.
		assert.strictEqual(queries.length, 2);
		assert.strictEqual(profiles[0].null_count, 0);
		// The median of an integer column formats as an integer, matching min_value and max_value
		// (which are stringified directly) and the column's own cells. It used to read '20.00'.
		assert.deepStrictEqual(profiles[0].summary_stats?.number_stats, {
			min_value: '10',
			max_value: '40',
			mean: '25.00',
			median: '20',
			stdev: '12.91',
		});
	});

	test('computes all histograms in one UNION ALL statement', async () => {
		const schema = [entry('a', ColumnDisplayType.Floating), entry('b', ColumnDisplayType.Floating)];
		const { client, queries } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 100 }];
			}
			if (/UNION ALL/.test(sql)) {
				// One statement covering both columns' bins, tagged by column index.
				return [
					{ h_col: 0, h_bin: 0, h_count: 60 }, { h_col: 0, h_bin: 1, h_count: 40 },
					{ h_col: 1, h_bin: 0, h_count: 100 },
				];
			}
			// Scalar: non-null count + range per column (drives the bin planning).
			return [{ agg_total: 100, agg_nn_0: 100, agg_n_0: 100, agg_lo_0: 0, agg_hi_0: 2, agg_nn_1: 100, agg_n_1: 100, agg_lo_1: 0, agg_hi_1: 5 }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const histogramSpec = { profile_type: ColumnProfileType.SmallHistogram, params: { method: ColumnHistogramParamsMethod.Fixed, num_bins: 2 } };
		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: schema.map((_, column_index) => ({
				column_index,
				profiles: [{ profile_type: ColumnProfileType.NullCount }, histogramSpec],
			})),
		});

		// Constructor count + one scalar query + one histogram UNION ALL = 3 round-trips for both columns.
		assert.strictEqual(queries.length, 3);
		assert.match(queries[2], /UNION ALL/);
		assert.deepStrictEqual(profiles[0][ColumnProfileType.SmallHistogram]?.bin_counts, [60, 40]);
		assert.deepStrictEqual(profiles[1][ColumnProfileType.SmallHistogram]?.bin_counts, [100, 0]);
	});

	test('computes all frequency tables in one UNION ALL statement', async () => {
		const schema = [entry('a', ColumnDisplayType.String), entry('b', ColumnDisplayType.String)];
		const { client, queries } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 100 }];
			}
			if (/UNION ALL/.test(sql)) {
				// Rows arrive out of order; the view restores top-k order via f_rn.
				return [
					{ f_col: 0, f_value: 'y', f_freq: 40, f_rn: 2 }, { f_col: 0, f_value: 'x', f_freq: 50, f_rn: 1 },
					{ f_col: 1, f_value: 'z', f_freq: 100, f_rn: 1 },
				];
			}
			return [{ agg_nn_0: 90, agg_nn_1: 100 }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const frequencySpec = { profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } };
		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: schema.map((_, column_index) => ({ column_index, profiles: [frequencySpec] })),
		});

		// Constructor count + one scalar query (for the non-null counts) + one frequency UNION ALL.
		assert.strictEqual(queries.length, 3);
		assert.match(queries[2], /UNION ALL/);
		const freq0 = profiles[0][ColumnProfileType.SmallFrequencyTable];
		assert.deepStrictEqual(freq0?.values, ['x', 'y']);
		assert.deepStrictEqual(freq0?.counts, [50, 40]);
		assert.strictEqual(freq0?.other_count, 0);  // nonNull 90 - shown 90
	});

	test('renders a boolean frequency column with CASE, not an unsupported boolean-to-varchar cast', async () => {
		const schema = [entry('flag', ColumnDisplayType.Boolean)];
		const { client, queries } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 100 }];
			}
			if (/UNION ALL/.test(sql) || /f_col/.test(sql)) {
				return [{ f_col: 0, f_value: 'true', f_freq: 100, f_rn: 1 }];
			}
			return [{ agg_nn_0: 100 }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{ column_index: 0, profiles: [{ profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } }] }],
		});

		// A boolean must render via CASE so the UNION ALL branch yields varchar cleanly.
		const frequencyQuery = queries.find(sql => /f_col/.test(sql))!;
		assert.match(frequencyQuery, /CASE WHEN "flag" THEN 'true' ELSE 'false' END/);
		assert.doesNotMatch(frequencyQuery, /CAST\("flag" AS VARCHAR\)/);
	});

	test('a failing frequency query degrades gracefully instead of sinking the whole pass', async () => {
		const schema = [entry('weird', ColumnDisplayType.String)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 100 }];
			}
			if (/f_col/.test(sql)) {
				throw new Error('Function TO_VARCHAR does not support the given argument type');
			}
			return [{ agg_total: 100, agg_nn_0: 95 }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [{ profile_type: ColumnProfileType.NullCount }, { profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } }],
			}],
		});

		// The pass still resolves and the null count (from the scalar query) survives; the frequency
		// table for the offending column is simply absent.
		assert.strictEqual(profiles[0].null_count, 5);  // total 100 - non-null 95
		assert.deepStrictEqual(profiles[0][ColumnProfileType.SmallFrequencyTable], { values: [], counts: [], other_count: 95 });
	});

	test('answers an empty table without issuing any profile queries', async () => {
		const schema = [entry('a', ColumnDisplayType.String), entry('b', ColumnDisplayType.Integer)];
		const { client, queries } = recordingClient((sql) => {
			// The constructor's row count reports the table is empty.
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: 0 }];
			}
			// Any other query would be a slow, unnecessary scan of an empty (metadata) view.
			throw new Error(`unexpected query for an empty table: ${sql}`);
		});
		const view = new SnowflakeTableView(client, '"db"."information_schema"."classes"', 'CLASSES', 'view', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: schema.map((_, column_index) => ({
				column_index,
				profiles: [
					{ profile_type: ColumnProfileType.NullCount },
					{ profile_type: ColumnProfileType.SummaryStats },
					{ profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } },
				],
			})),
		});

		// Only the constructor's count(*) ran; the empty table needs no scalar/histogram/frequency query.
		assert.strictEqual(queries.length, 1);
		assert.deepStrictEqual(profiles.map(p => p.null_count), [0, 0]);
		assert.deepStrictEqual(profiles[0][ColumnProfileType.SmallFrequencyTable], { values: [], counts: [], other_count: 0 });
	});
});

// The Data Explorer's query client fetches NUMBER values as exact digit strings and FLOAT values as JS
// numbers (see `normalizeNumericColumns`), so these rows are shaped the way that client delivers them.
suite('Snowflake Exact Numbers', () => {

	// A double cannot hold this; Number() reads it as 9007199254740992.
	const WIDE_DECIMAL = '9007199254740993.01';
	const WIDE_INTEGER = '12345678901234567890123456789012345678';

	test('formats NUMBER cells from their exact digits and FLOAT cells as before', async () => {
		const schema = [
			entry('dec', ColumnDisplayType.Decimal),
			entry('wide_dec', ColumnDisplayType.Decimal),
			entry('id', ColumnDisplayType.Integer),
			entry('flt', ColumnDisplayType.Floating),
		];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '3' }];
			}
			return [
				{ c0: '1.005', c1: WIDE_DECIMAL, c2: WIDE_INTEGER, c3: 1.005 },
				{ c0: '-1.005', c1: `-${WIDE_DECIMAL}`, c2: '-9007199254740993', c3: -1.005 },
				{ c0: null, c1: null, c2: null, c3: null },
			];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { columns } = await view.getDataValues({
			format_options: FORMAT_OPTIONS,
			columns: schema.map((_, column_index) => ({ column_index, spec: { first_index: 0, last_index: 2 } })),
		});

		assert.deepStrictEqual(columns, [
			// Half-way values round away from zero; Number('1.005') is just below the half-way point,
			// so it would have read 1.00.
			['1.01', '-1.01', 0],
			// Wide values still switch to exponential past max_integral_digits.
			['9.01e+15', '-9.01e+15', 0],
			// A NUMBER(38,0) keeps every digit rather than rounding at 2^53.
			[WIDE_INTEGER, '-9007199254740993', 0],
			// FLOAT is a double either way, so it rounds as it always did.
			['1.00', '-1.00', 0],
		]);
	});

	test('exports a NUMBER cell as its exact digits', async () => {
		const schema = [entry('wide_dec', ColumnDisplayType.Decimal)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '1' }];
			}
			return [{ c0: WIDE_DECIMAL }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const exported = await view.exportDataSelection({
			selection: { kind: TableSelectionKind.SingleCell, selection: { row_index: 0, column_index: 0 } },
			format: ExportFormat.Csv,
		});

		assert.strictEqual(exported.data, WIDE_DECIMAL);
	});

	test('reports a decimal column\'s min, max, and median exactly, with counts and sums coerced', async () => {
		const schema = [entry('dec', ColumnDisplayType.Decimal)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '5' }];
			}
			// Every NUMBER aggregate arrives as a string: the counts, the sums, and the range and median.
			return [{
				agg_total: '5', agg_nn_0: '4', agg_n_0: '4',
				agg_lo_0: '-0.050', agg_hi_0: WIDE_DECIMAL, agg_med_0: '1.005',
				agg_s_0: '10.000', agg_ss_0: '30.000000',
			}];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [{ profile_type: ColumnProfileType.NullCount }, { profile_type: ColumnProfileType.SummaryStats }],
			}],
		});

		assert.strictEqual(profiles[0].null_count, 1);
		assert.deepStrictEqual(profiles[0].summary_stats?.number_stats, {
			min_value: '-0.050',
			max_value: WIDE_DECIMAL,
			mean: '2.50',
			// Number('1.005') would have rounded down to 1.00.
			median: '1.01',
			stdev: '1.29',
		});
	});

	test('formats a FLOAT column\'s range as its cells, and an exact column\'s as its own digits', async () => {
		const schema = [entry('flt', ColumnDisplayType.Floating), entry('dec', ColumnDisplayType.Decimal)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '2' }];
			}
			// FLOAT aggregates arrive as numbers and NUMBER aggregates as exact text.
			return [{
				agg_total: '2',
				agg_n_0: '2', agg_lo_0: -1.005, agg_hi_0: 12345678.9, agg_med_0: 1.5, agg_s_0: 0, agg_ss_0: 0,
				agg_n_1: '2', agg_lo_1: '-1.050', agg_hi_1: '2.500', agg_med_1: '0.725', agg_s_1: 0, agg_ss_1: 0,
			}];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: schema.map((_, column_index) => ({ column_index, profiles: [{ profile_type: ColumnProfileType.SummaryStats }] })),
		});

		assert.deepStrictEqual(
			profiles.map(p => ({ min: p.summary_stats?.number_stats?.min_value, max: p.summary_stats?.number_stats?.max_value })),
			[
				// Formatted like the column's FLOAT cells, past max_integral_digits included.
				{ min: '-1.00', max: '1.23e+7' },
				// An exact decimal keeps its own digits, scale and all, as the Python backend reports it.
				{ min: '-1.050', max: '2.500' },
			]);
	});

	test('formats an integer column\'s wide range and zero-fraction median as integers', async () => {
		const schema = [entry('id', ColumnDisplayType.Integer)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '2' }];
			}
			// PERCENTILE_CONT widens the scale, so the median of whole values can carry a zero fraction.
			return [{
				agg_total: '2', agg_nn_0: '2', agg_n_0: '2',
				agg_lo_0: '-9007199254740993', agg_hi_0: WIDE_INTEGER, agg_med_0: '9007199254740993.000',
				agg_s_0: '0', agg_ss_0: '0',
			}];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{ column_index: 0, profiles: [{ profile_type: ColumnProfileType.SummaryStats }] }],
		});

		const stats = profiles[0].summary_stats?.number_stats;
		assert.deepStrictEqual(
			{ min_value: stats?.min_value, max_value: stats?.max_value, median: stats?.median },
			{ min_value: '-9007199254740993', max_value: WIDE_INTEGER, median: '9007199254740993' });
	});

	test('plans and fills a histogram from string counts and range', async () => {
		const schema = [entry('dec', ColumnDisplayType.Decimal)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '100' }];
			}
			if (/UNION ALL/.test(sql) || /h_col/.test(sql)) {
				return [{ h_col: '0', h_bin: '0', h_count: '60' }, { h_col: '0', h_bin: '1', h_count: '40' }];
			}
			return [{ agg_total: '100', agg_nn_0: '100', agg_n_0: '100', agg_lo_0: '0.00', agg_hi_0: '2.00' }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [{ profile_type: ColumnProfileType.SmallHistogram, params: { method: ColumnHistogramParamsMethod.Fixed, num_bins: 2 } }],
			}],
		});

		assert.deepStrictEqual(profiles[0][ColumnProfileType.SmallHistogram], {
			bin_edges: ['0', '1', '2'],
			bin_counts: [60, 40],
			quantiles: [],
		});
	});

	test('sums and buckets in doubles so a wide NUMBER cannot overflow 38 digits', async () => {
		// Fixed-point arithmetic on a NUMBER(38,0) near 10^37 overflows in Snowflake: squaring it for the
		// standard deviation always does, and even `* 1.0` needs a 39th digit. A failed scalar query
		// would lose every column's summary in the batch.
		const schema = [entry('wide', ColumnDisplayType.Integer)];
		const { client, queries } = recordingClient((sql) => {
			if (/count\(\*\) AS "n"/.test(sql)) {
				return [{ n: '2' }];
			}
			if (/h_col/.test(sql)) {
				return [{ h_col: '0', h_bin: '0', h_count: '1' }, { h_col: '0', h_bin: '1', h_count: '1' }];
			}
			return [{ agg_total: '2', agg_nn_0: '2', agg_n_0: '2', agg_lo_0: '1', agg_hi_0: WIDE_INTEGER, agg_med_0: '1', agg_s_0: '1.2e37', agg_ss_0: '1.5e74' }];
		});
		const view = new SnowflakeTableView(client, '"db"."public"."t"', 't', 'table', schema);

		await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [
					{ profile_type: ColumnProfileType.SummaryStats },
					{ profile_type: ColumnProfileType.SmallHistogram, params: { method: ColumnHistogramParamsMethod.Fixed, num_bins: 2 } },
				],
			}],
		});

		// The select-list expression each alias names, across every query the pass issued.
		const expression = (alias: string) =>
			new RegExp(`(?:SELECT |, )(?<expr>[^,]+?) AS "${alias}"`).exec(queries.join('\n'))?.groups?.expr;
		assert.deepStrictEqual(
			{ sum: expression('agg_s_0'), sumSq: expression('agg_ss_0'), bucket: expression('h_bin') },
			{
				sum: 'sum("wide"::DOUBLE)',
				sumSq: 'sum("wide"::DOUBLE * "wide"::DOUBLE)',
				bucket: 'CAST(FLOOR(("wide"::DOUBLE - 1) / 6.172839450617284e+36) AS INTEGER)',
			});
	});
});

suite('Snowflake Row Filter SQL', () => {

	function columnSchema(column_name: string, type_display: ColumnDisplayType): ColumnSchema {
		return { column_name, column_index: 0, type_name: 'x', type_display };
	}

	function compareFilter(column_name: string, type_display: ColumnDisplayType, value: string): RowFilter {
		return {
			filter_id: 'f',
			filter_type: RowFilterType.Compare,
			column_schema: columnSchema(column_name, type_display),
			condition: RowFilterCondition.And,
			params: { op: FilterComparisonOp.Eq, value },
		};
	}

	test('temporal comparisons quote and cast the literal so it is not read as arithmetic', () => {
		// A bare 2026-07-22 would be parsed as 2026 - 7 - 22; the cast forces a date comparison.
		assert.strictEqual(makeWhereExpr(compareFilter('D', ColumnDisplayType.Date, '2026-07-22')), `"D" = '2026-07-22'::DATE`);
		assert.strictEqual(makeWhereExpr(compareFilter('TS', ColumnDisplayType.Datetime, '2026-07-22 13:45:00')), `"TS" = '2026-07-22 13:45:00'::TIMESTAMP`);
		assert.strictEqual(makeWhereExpr(compareFilter('T', ColumnDisplayType.Time, '13:45:00')), `"T" = '13:45:00'::TIME`);
	});

	test('string comparisons are quoted; numbers pass through unquoted', () => {
		assert.strictEqual(makeWhereExpr(compareFilter('name', ColumnDisplayType.String, 'O\'Brien')), `"name" = 'O''Brien'`);
		assert.strictEqual(makeWhereExpr(compareFilter('n', ColumnDisplayType.Integer, '42')), `"n" = 42`);
	});

	function searchFilter(search_type: TextSearchType, term: string, case_sensitive: boolean): RowFilter {
		return {
			filter_id: 'f',
			filter_type: RowFilterType.Search,
			column_schema: columnSchema('name', ColumnDisplayType.String),
			condition: RowFilterCondition.And,
			params: { search_type, term, case_sensitive },
		};
	}

	test('LIKE wildcards in the search term are escaped so they match literally', () => {
		// Unescaped, '10%' would match anything starting with 10, and 'a_b' would match 'axb'.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.Contains, '10%', true)), `"name" LIKE '%' || '10!%' || '%' ESCAPE '!'`);
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.StartsWith, 'a_b', true)), `"name" LIKE 'a!_b' || '%' ESCAPE '!'`);
		// The escape character itself is escaped, in one pass, so it is never double-escaped.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.EndsWith, 'wow!', true)), `"name" LIKE '%' || 'wow!!' ESCAPE '!'`);
	});

	test('every LIKE variant carries the ESCAPE clause that gives those escapes meaning', () => {
		const variants = [TextSearchType.Contains, TextSearchType.NotContains, TextSearchType.StartsWith, TextSearchType.EndsWith]
			.map(type => makeWhereExpr(searchFilter(type, '50%_off', false)));

		assert.deepStrictEqual(variants, [
			`lower("name") LIKE '%' || lower('50!%!_off') || '%' ESCAPE '!'`,
			`lower("name") NOT LIKE '%' || lower('50!%!_off') || '%' ESCAPE '!'`,
			`lower("name") LIKE lower('50!%!_off') || '%' ESCAPE '!'`,
			`lower("name") LIKE '%' || lower('50!%!_off') ESCAPE '!'`,
		]);
	});

	test('regex search is left alone, since REGEXP_LIKE has no LIKE wildcards', () => {
		// '%' and '_' carry no special meaning in a regex, so escaping them would corrupt the pattern.
		assert.strictEqual(
			makeWhereExpr(searchFilter(TextSearchType.RegexMatch, '^10%_$', true)),
			`REGEXP_LIKE("name", '.*' || '^10%_$' || '.*', 'c')`);
	});
});
