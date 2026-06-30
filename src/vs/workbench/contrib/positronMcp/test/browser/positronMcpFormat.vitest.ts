/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { QueryTableSummaryResult, Variable, VariableKind } from '../../../../services/languageRuntime/common/positronVariablesComm.js';
import { formatPackages, formatTableProfile, formatVariableDetail, formatVariables, truncateOutput } from '../../browser/positronMcpFormat.js';

/** Build a Variable with only the fields the formatters read. */
function variable(overrides: Partial<Variable>): Variable {
	return {
		access_key: 'k', display_name: 'x', display_type: 'int', display_value: '1',
		type_info: '', length: 0, size: 0, has_children: false, has_viewer: false,
		is_truncated: false, kind: VariableKind.Number, updated_time: 0,
		...overrides,
	};
}

describe('positronMcp formatters', () => {
	it('truncateOutput marks output past the cap', () => {
		expect(truncateOutput('short')).toBe('short');
		expect(truncateOutput('a'.repeat(9000))).toContain('[output truncated]');
	});

	it('formatVariables summarizes a dataframe and lists vars', () => {
		const vars = [
			variable({ display_name: 'df', display_type: 'DataFrame', display_value: 'DataFrame [10 rows x 3 columns]' }),
			variable({ display_name: 'n', display_type: 'int', display_value: '42' }),
		];
		expect(formatVariables(vars, 'Python')).toMatchInlineSnapshot(`
			"You have 2 variables in your Python workspace:

			• df - DataFrame : DataFrame with 10 rows × 3 columns
			• n - int : 42

			DataFrames: df (10 rows × 3 columns)"
		`);
	});

	it('formatVariables handles the empty case', () => {
		expect(formatVariables([], 'R')).toBe('No variables in your workspace yet');
	});

	it('formatVariableDetail includes children when present', () => {
		const v = variable({ display_name: 'df', display_type: 'DataFrame', display_value: 'x', length: 2, has_children: true });
		const children = [
			variable({ display_name: 'a', display_type: 'int64', display_value: '[1, 2]' }),
			variable({ display_name: 'b', display_type: 'float64', display_value: '[1.0]' }),
		];
		expect(formatVariableDetail(v, children)).toMatchInlineSnapshot(`
			"df: DataFrame
			Value: x
			Length: 2

			Children (2):
			  a - int64 : [1, 2]
			  b - float64 : [1.0]"
		`);
	});

	it('formatPackages sorts and flags attached/outdated', () => {
		const pkgs = [
			{ id: '1', name: 'numpy', displayName: 'numpy', version: '1.0', attached: true },
			{ id: '2', name: 'Aaa', displayName: 'Aaa', version: '2.0', outdated: true, latestVersion: '3.0' },
		] as ILanguageRuntimePackage[];
		expect(formatPackages(pkgs, 'Python')).toMatchInlineSnapshot(`
			"2 packages installed in your Python session:

			• Aaa 2.0 (outdated -> 3.0)
			• numpy 1.0 (attached)"
		`);
	});

	it('formatTableProfile matches profiles to schema by name', () => {
		const result: QueryTableSummaryResult = {
			num_rows: 100, num_columns: 2,
			column_schemas: [
				JSON.stringify({ column_name: 'age', type_display: 'int64' }),
				JSON.stringify({ column_name: 'name', type_display: 'object' }),
			],
			// 'name' profile omitted (as Python does when stats fail) -> still listed, no stats.
			column_profiles: [
				JSON.stringify({ column_name: 'age', summary_stats: { number_stats: { min_value: '1', max_value: '99', mean: '50' } } }),
			],
		};
		expect(formatTableProfile('df', result)).toMatchInlineSnapshot(`
			"Profile of "df" (100 rows x 2 columns):

			• age (int64): min 1, max 99, mean 50
			• name (object)"
		`);
	});

	it('formatTableProfile filters to requested columns', () => {
		const result: QueryTableSummaryResult = {
			num_rows: 5, num_columns: 2,
			column_schemas: [
				JSON.stringify({ column_name: 'a', type_display: 'int' }),
				JSON.stringify({ column_name: 'b', type_display: 'int' }),
			],
			column_profiles: [],
		};
		expect(formatTableProfile('df', result, ['b'])).toContain('• b (int)');
		expect(formatTableProfile('df', result, ['b'])).not.toContain('• a (int)');
		expect(formatTableProfile('df', result, ['nope'])).toContain('None of the requested columns');
	});
});
