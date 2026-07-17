/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ColumnDisplayType, ColumnHistogramParamsMethod, ColumnProfileType, FormatOptions } from 'positron-data-explorer-protocol';
import { IRedshiftQueryClient, RedshiftSchemaEntry, RedshiftTableView } from '../redshiftTableView.js';

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
	const client: IRedshiftQueryClient = {
		runQuery: async (sql: string) => {
			queries.push(sql);
			return handler(sql);
		},
	};
	return { client, queries };
}

function entry(column_name: string, type_display: ColumnDisplayType): RedshiftSchemaEntry {
	return { column_name, column_type: 'x', type_display };
}

suite('Redshift Column Profiles', () => {

	test('batches null counts for every column into a single scan', async () => {
		const schema = [
			entry('a', ColumnDisplayType.Integer),
			entry('b', ColumnDisplayType.String),
			entry('c', ColumnDisplayType.Integer),
		];
		const { client, queries } = recordingClient((sql) => {
			// The constructor's row count.
			if (/count\(\*\) AS n\b/.test(sql)) {
				return [{ n: 300000 }];
			}
			// The batched scalar-aggregate query: total plus per-column non-null counts.
			return [{ agg_total: 300000, agg_nn_0: 300000, agg_nn_1: 299000, agg_nn_2: 250000 }];
		});
		const view = new RedshiftTableView(client, '"public"."flights"', 'flights', 'table', schema);

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
			if (/count\(\*\) AS n\b/.test(sql)) {
				return [{ n: 4 }];
			}
			// The batched scalar query, including the median folded in as an ordered-set aggregate.
			return [{ agg_total: 4, agg_nn_0: 4, agg_n_0: 4, agg_lo_0: 10, agg_hi_0: 40, agg_s_0: 100, agg_ss_0: 3000, agg_med_0: 20 }];
		});
		const view = new RedshiftTableView(client, '"public"."t"', 't', 'table', schema);

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
			if (/count\(\*\) AS n\b/.test(sql)) {
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
		const view = new RedshiftTableView(client, '"public"."t"', 't', 'table', schema);

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
			if (/count\(\*\) AS n\b/.test(sql)) {
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
		const view = new RedshiftTableView(client, '"public"."t"', 't', 'table', schema);

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
			if (/count\(\*\) AS n\b/.test(sql)) {
				return [{ n: 100 }];
			}
			if (/UNION ALL/.test(sql) || /f_col/.test(sql)) {
				return [{ f_col: 0, f_value: 'true', f_freq: 100, f_rn: 1 }];
			}
			return [{ agg_nn_0: 100 }];
		});
		const view = new RedshiftTableView(client, '"public"."t"', 't', 'table', schema);

		await view.computeColumnProfiles({
			callback_id: 'cb',
			format_options: FORMAT_OPTIONS,
			profiles: [{ column_index: 0, profiles: [{ profile_type: ColumnProfileType.SmallFrequencyTable, params: { limit: 5 } }] }],
		});

		// Redshift cannot cast boolean to varchar; the frequency query must use a CASE expression.
		const frequencyQuery = queries.find(sql => /f_col/.test(sql))!;
		assert.match(frequencyQuery, /CASE WHEN "flag" THEN 'true' ELSE 'false' END/);
		assert.doesNotMatch(frequencyQuery, /CAST\("flag" AS VARCHAR\)/);
	});

	test('a failing frequency query degrades gracefully instead of sinking the whole pass', async () => {
		const schema = [entry('weird', ColumnDisplayType.String)];
		const { client } = recordingClient((sql) => {
			if (/count\(\*\) AS n\b/.test(sql)) {
				return [{ n: 100 }];
			}
			if (/f_col/.test(sql)) {
				throw new Error('cannot cast type hllsketch to character varying');
			}
			return [{ agg_total: 100, agg_nn_0: 95 }];
		});
		const view = new RedshiftTableView(client, '"public"."t"', 't', 'table', schema);

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
});
