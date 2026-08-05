/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ColumnDisplayType, ColumnHistogramParamsMethod, ColumnProfileType, ColumnSchema, ExportFormat, FilterComparisonOp, FormatOptions, RowFilter, RowFilterCondition, RowFilterType, TableSelectionKind, TextSearchType } from 'positron-data-explorer-protocol';
import { IDatabricksQueryClient, makeWhereExpr, DatabricksSchemaEntry, DatabricksTableView } from '../databricksTableView.js';

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
	const client: IDatabricksQueryClient = {
		runQuery: async (sql: string) => {
			queries.push(sql);
			return handler(sql);
		},
	};
	return { client, queries };
}

function entry(column_name: string, type_display: ColumnDisplayType, column_type = 'x'): DatabricksSchemaEntry {
	return { column_name, column_type, type_display };
}

/** Matches the constructor's row-count query. */
const isCountQuery = (sql: string) => /count\(\*\) AS `n`/.test(sql);

suite('Databricks Column Profiles', () => {

	test('batches null counts for every column into a single scan', async () => {
		const schema = [
			entry('a', ColumnDisplayType.Integer),
			entry('b', ColumnDisplayType.String),
			entry('c', ColumnDisplayType.Integer),
		];
		const { client, queries } = recordingClient((sql) => {
			if (isCountQuery(sql)) {
				return [{ n: 300000 }];
			}
			// The batched scalar-aggregate query: total plus per-column non-null counts.
			return [{ agg_total: 300000, agg_nn_0: 300000, agg_nn_1: 299000, agg_nn_2: 250000 }];
		});
		const view = new DatabricksTableView(client, '`main`.`sales`.`flights`', 'flights', 'table', schema);

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
			if (isCountQuery(sql)) {
				return [{ n: 4 }];
			}
			// The batched scalar query, including the median folded in as an ordered-set aggregate.
			return [{ agg_total: 4, agg_nn_0: 4, agg_n_0: 4, agg_lo_0: 10, agg_hi_0: 40, agg_s_0: 100, agg_ss_0: 3000, agg_med_0: 20 }];
		});
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

		const { profiles } = await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [{ profile_type: ColumnProfileType.NullCount }, { profile_type: ColumnProfileType.SummaryStats }],
			}],
		});

		// Constructor count + one scalar query; the median costs no separate round-trip.
		assert.strictEqual(queries.length, 2);
		assert.match(queries[1], /percentile_cont\(0\.5\) WITHIN GROUP \(ORDER BY `n`\)/);
		assert.deepStrictEqual(profiles[0].summary_stats?.number_stats, {
			min_value: '10',
			max_value: '40',
			mean: '25.00',
			median: '20.00',
			stdev: '12.91',
		});
	});

	test('computes all histograms in one UNION ALL statement', async () => {
		const schema = [entry('a', ColumnDisplayType.Floating), entry('b', ColumnDisplayType.Floating)];
		const { client, queries } = recordingClient((sql) => {
			if (isCountQuery(sql)) {
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
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

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
			if (isCountQuery(sql)) {
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
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

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

	test('renders a boolean frequency column with CASE, not an unsupported boolean-to-string cast', async () => {
		const schema = [entry('flag', ColumnDisplayType.Boolean, 'boolean')];
		const { client, queries } = recordingClient((sql) => {
			if (isCountQuery(sql)) {
				return [{ n: 100 }];
			}
			if (/f_col/.test(sql)) {
				return [{ f_col: 0, f_value: 'true', f_freq: 100, f_rn: 1 }];
			}
			return [{ agg_nn_0: 100 }];
		});
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

		await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{ column_index: 0, profiles: [{ profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } }] }],
		});

		const frequencyQuery = queries.find(sql => /f_col/.test(sql))!;
		assert.match(frequencyQuery, /CASE WHEN `flag` THEN 'true' ELSE 'false' END/);
		assert.doesNotMatch(frequencyQuery, /CAST\(`flag` AS STRING\)/);
	});

	test('groups a map column by its JSON text, which Spark can group', async () => {
		// Spark cannot GROUP BY (or count DISTINCT) a MAP at all, so both the distinct count and the
		// frequency branch must go through to_json; grouping the raw column would fail the statement.
		const schema = [entry('tags', ColumnDisplayType.Object, 'map<string,string>')];
		const { client, queries } = recordingClient((sql) => {
			if (isCountQuery(sql)) {
				return [{ n: 10 }];
			}
			if (/f_col/.test(sql)) {
				return [{ f_col: 0, f_value: '{"a":"b"}', f_freq: 10, f_rn: 1 }];
			}
			return [{ agg_total: 10, agg_nn_0: 10, agg_nu_0: 3 }];
		});
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

		await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{
				column_index: 0,
				profiles: [{ profile_type: ColumnProfileType.SummaryStats }, { profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } }],
			}],
		});

		const scalarQuery = queries.find(sql => /agg_nu_0/.test(sql))!;
		const frequencyQuery = queries.find(sql => /f_col/.test(sql))!;
		assert.match(scalarQuery, /count\(DISTINCT to_json\(`tags`\)\)/);
		assert.match(frequencyQuery, /GROUP BY to_json\(`tags`\)/);
	});

	test('groups a binary column by its hex text so identical blobs share a bucket', async () => {
		const schema = [entry('payload', ColumnDisplayType.Object, 'binary')];
		const { client, queries } = recordingClient((sql) => {
			if (isCountQuery(sql)) {
				return [{ n: 10 }];
			}
			if (/f_col/.test(sql)) {
				return [{ f_col: 0, f_value: 'DEADBEEF', f_freq: 10, f_rn: 1 }];
			}
			return [{ agg_nn_0: 10 }];
		});
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

		await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{ column_index: 0, profiles: [{ profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } }] }],
		});

		assert.match(queries.find(sql => /f_col/.test(sql))!, /GROUP BY hex\(`payload`\)/);
	});

	test('a failing frequency query degrades gracefully instead of sinking the whole pass', async () => {
		const schema = [entry('weird', ColumnDisplayType.Unknown, 'something_new')];
		const { client } = recordingClient((sql) => {
			if (isCountQuery(sql)) {
				return [{ n: 100 }];
			}
			if (/f_col/.test(sql)) {
				throw new Error('DATATYPE_MISMATCH: cannot cast something_new to string');
			}
			return [{ agg_total: 100, agg_nn_0: 95 }];
		});
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

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
			if (isCountQuery(sql)) {
				return [{ n: 0 }];
			}
			// Any other query would be a needless full statement round-trip on the warehouse.
			throw new Error(`unexpected query for an empty table: ${sql}`);
		});
		const view = new DatabricksTableView(client, '`main`.`information_schema`.`tables`', 'tables', 'view', schema);

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

		// Only the constructor's count(*) ran.
		assert.strictEqual(queries.length, 1);
		assert.deepStrictEqual(profiles.map(p => p.null_count), [0, 0]);
		assert.deepStrictEqual(profiles[0][ColumnProfileType.SmallFrequencyTable], { values: [], counts: [], other_count: 0 });
	});
});

suite('Databricks Row Index Queries', () => {

	test('the row-number window falls back to the first sortable column, skipping complex ones', async () => {
		// Spark rejects ORDER BY over a MAP outright, so a table whose first column is complex must not
		// seed the window with it.
		const schema = [entry('tags', ColumnDisplayType.Object, 'map<string,string>'), entry('id', ColumnDisplayType.Integer)];
		const { client, queries } = recordingClient((sql) => isCountQuery(sql) ? [{ n: 5 }] : []);
		const view = new DatabricksTableView(client, '`main`.`sales`.`t`', 't', 'table', schema);

		await view.exportDataSelection({
			format: ExportFormat.Csv,
			selection: { kind: TableSelectionKind.RowIndices, selection: { indices: [0, 2] } },
		});

		const exportQuery = queries.find(sql => /ROW_NUMBER/.test(sql))!;
		assert.match(exportQuery, /ROW_NUMBER\(\) OVER \(ORDER BY `id`\)/);
	});
});

suite('Databricks Row Filter SQL', () => {

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

	function searchFilter(search_type: TextSearchType, term: string, case_sensitive: boolean): RowFilter {
		return {
			filter_id: 'f',
			filter_type: RowFilterType.Search,
			column_schema: columnSchema('name', ColumnDisplayType.String),
			condition: RowFilterCondition.And,
			params: { search_type, term, case_sensitive },
		};
	}

	test('temporal comparisons quote and cast the literal so it is not read as arithmetic', () => {
		// A bare 2026-07-22 would be parsed as 2026 - 7 - 22; the cast forces a date comparison.
		assert.strictEqual(makeWhereExpr(compareFilter('d', ColumnDisplayType.Date, '2026-07-22')), `\`d\` = CAST('2026-07-22' AS DATE)`);
		assert.strictEqual(makeWhereExpr(compareFilter('ts', ColumnDisplayType.Datetime, '2026-07-22 13:45:00')), `\`ts\` = CAST('2026-07-22 13:45:00' AS TIMESTAMP)`);
	});

	test('string comparisons are quoted; numbers pass through unquoted', () => {
		assert.strictEqual(makeWhereExpr(compareFilter('name', ColumnDisplayType.String, `O'Brien`)), `\`name\` = 'O''Brien'`);
		assert.strictEqual(makeWhereExpr(compareFilter('n', ColumnDisplayType.Integer, '42')), '`n` = 42');
	});

	test('a backslash in a literal is escaped, since Databricks reads escape sequences', () => {
		// Without doubling, a trailing backslash would escape the closing quote.
		assert.strictEqual(makeWhereExpr(compareFilter('p', ColumnDisplayType.String, 'C:\\temp')), `\`p\` = 'C:\\\\temp'`);
	});

	test('a column name containing a backtick is escaped by doubling it', () => {
		assert.strictEqual(makeWhereExpr(compareFilter('we`ird', ColumnDisplayType.Integer, '1')), '`we``ird` = 1');
	});

	test('regex search uses RLIKE, with case-insensitivity as an inline flag', () => {
		// RLIKE is already a partial match, so the term needs no `.*` wrapping.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.RegexMatch, '^ab.*', true)), `\`name\` RLIKE '^ab.*'`);
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.RegexMatch, '^ab.*', false)), `\`name\` RLIKE '(?i)^ab.*'`);
	});

	test('a case-insensitive contains search lowers both sides', () => {
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.Contains, 'AB', false)), `lower(\`name\`) LIKE '%' || lower('AB') || '%' ESCAPE '!'`);
	});

	test('LIKE wildcards in the search term are escaped so they match literally', () => {
		// Unescaped, '10%' would match anything starting with 10, and 'a_b' would match 'axb'.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.Contains, '10%', true)), `\`name\` LIKE '%' || '10!%' || '%' ESCAPE '!'`);
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.StartsWith, 'a_b', true)), `\`name\` LIKE 'a!_b' || '%' ESCAPE '!'`);
		// The escape character itself is escaped, in one pass, so it is never double-escaped.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.EndsWith, 'wow!', true)), `\`name\` LIKE '%' || 'wow!!' ESCAPE '!'`);
	});

	test('every LIKE variant carries the ESCAPE clause that gives those escapes meaning', () => {
		const variants = [TextSearchType.Contains, TextSearchType.NotContains, TextSearchType.StartsWith, TextSearchType.EndsWith]
			.map(type => makeWhereExpr(searchFilter(type, '50%_off', false)));

		assert.deepStrictEqual(variants, [
			`lower(\`name\`) LIKE '%' || lower('50!%!_off') || '%' ESCAPE '!'`,
			`lower(\`name\`) NOT LIKE '%' || lower('50!%!_off') || '%' ESCAPE '!'`,
			`lower(\`name\`) LIKE lower('50!%!_off') || '%' ESCAPE '!'`,
			`lower(\`name\`) LIKE '%' || lower('50!%!_off') ESCAPE '!'`,
		]);
	});

	test('a backslash in the search term stays literal rather than escaping the next character', () => {
		// Databricks' LIKE takes backslash as its default escape character; naming '!' explicitly means a
		// searched-for backslash matches a backslash in the data. The doubling here is the string
		// literal's own escaping, not the pattern's.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.Contains, 'C:\\x', true)), `\`name\` LIKE '%' || 'C:\\\\x' || '%' ESCAPE '!'`);
	});

	test('regex search is left alone, since RLIKE has no LIKE wildcards', () => {
		// '%' and '_' carry no special meaning in a regex, so escaping them would corrupt the pattern.
		assert.strictEqual(makeWhereExpr(searchFilter(TextSearchType.RegexMatch, '^10%_$', true)), `\`name\` RLIKE '^10%_$'`);
	});
});
