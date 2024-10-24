/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	BackendState,
	ColumnDisplayType,
	ColumnProfileType,
	ColumnSchema,
	ColumnValue,
	DataExplorerBackendRequest,
	DataExplorerResponse,
	DataExplorerRpc,
	FormatOptions,
	GetDataValuesParams,
	GetSchemaParams,
	RowFilterType,
	SupportedFeatures,
	SupportStatus,
	TableData,
	TableSchema
} from '../interfaces';
import { randomUUID } from 'crypto';

const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 9,
	max_value_length: 100
};

// Not sure why it is not possible to use Mocha's 'before' for this
async function activateExtension() {
	// Ensure the extension is activated
	await vscode.extensions.getExtension('vscode.positron-duckdb')?.activate();
}

async function runQuery<Type>(query: string): Promise<Array<Type>> {
	await activateExtension();
	// Uncomment to debug queries being sent
	// console.log(query);
	return vscode.commands.executeCommand('positron-duckdb.runQuery', query);
}

async function dxExec(rpc: DataExplorerRpc): Promise<any> {
	await activateExtension();
	const resp: DataExplorerResponse = await vscode.commands.executeCommand(
		'positron-duckdb.dataExplorerRpc', rpc
	);
	if (resp.error_message) {
		return Promise.reject(new Error(resp.error_message));
	} else if (resp.result === undefined) {
		console.log(JSON.stringify(resp));
		return Promise.reject(new Error('No error message or result in response'));
	} else {
		return resp.result;
	}
}

function makeTempTableName(): string {
	return `positron_${randomUUID().slice(0, 5)}`;
}

type InsertColumn = { name: string; type: string; values: Array<string> };

async function createTempTable(
	tableName: string,
	columns: Array<InsertColumn>
) {
	// Create the table with indicated schema
	const schema = columns.map(column => `${column.name} ${column.type}`).join(', ');
	await runQuery(`CREATE TABLE ${tableName} (${schema});`);

	// Assuming at least one column and all values arrays same length
	const length = columns[0].values.length;

	const tuples: Array<string> = [];
	for (let i = 0; i < length; i++) {
		tuples.push(`(${columns.map(c => c.values[i]).join(', ')})`);
	}
	await runQuery(`INSERT INTO ${tableName} VALUES\n${tuples.join(',\n')};`);

	// Now set up the new table so it will respond to RPCs with a duckdb://${tableName} prefix
	await dxExec({
		method: DataExplorerBackendRequest.OpenDataset,
		params: { uri: `duckdb://${tableName}` }
	});
}

async function getState(uri: string): Promise<BackendState> {
	return dxExec({
		method: DataExplorerBackendRequest.GetState,
		uri,
		params: {}
	});
}

async function getAllDataValues(tableName: string, formatOptions?: FormatOptions) {
	const uri = `duckdb://${tableName}`;
	const state = await getState(uri);
	const shape = state.table_shape;
	return dxExec({
		method: DataExplorerBackendRequest.GetDataValues,
		uri,
		params: {
			columns: Array.from(
				{ length: shape.num_columns }, (_, i) => i
			).map(column_index => {
				return {
					column_index,
					spec: { first_index: 0, last_index: shape.num_rows - 1 }
				};
			}),
			format_options: formatOptions ?? DEFAULT_FORMAT_OPTIONS
		} satisfies GetDataValuesParams
	}) as Promise<TableData>;
}

suite('Positron DuckDB Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Command `positron-duckdb.runQuery` should be registered', async () => {
		await activateExtension();

		// Check if the command is registered
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('positron-duckdb.runQuery'), 'Command is not registered');
	});

	test('DuckDB query should return expected result', async () => {
		const result = await runQuery<{ answer: number }>('select 42 as answer');
		assert.ok(result, 'The command did not return any result');
		assert.strictEqual(result[0].answer, 42,
			'Expected DuckDB query result to return answer as 42');
	});

	test('DuckDB flights.parquet', async () => {
		const uri = path.join(__dirname, 'data', 'flights.parquet');

		let result = await dxExec({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri }
		});
		assert.deepStrictEqual(result, {});

		const state = await getState(uri);
		assert.deepStrictEqual(state, {
			display_name: 'flights.parquet',
			table_shape: { num_rows: 100, num_columns: 19 },
			table_unfiltered_shape: { num_rows: 100, num_columns: 19 },
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
					support_status: SupportStatus.Supported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: Object.values(RowFilterType).map((value) => {
						return { row_filter_type: value, support_status: SupportStatus.Supported };
					})
				},
				get_column_profiles: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{
							profile_type: ColumnProfileType.NullCount,
							support_status: SupportStatus.Supported
						}
					]
				},
				set_sort_columns: { support_status: SupportStatus.Supported, },
				export_data_selection: {
					support_status: SupportStatus.Unsupported,
					supported_formats: []
				}
			}
		} satisfies BackendState);

		result = await dxExec({
			method: DataExplorerBackendRequest.GetSchema,
			uri,
			params: {
				column_indices: Array.from({ length: 19 }, (_, index) => index)
			} satisfies GetSchemaParams
		});

		const schemaEntries: Array<[string, string, ColumnDisplayType]> = [
			['year', 'SMALLINT', ColumnDisplayType.Number],
			['month', 'TINYINT', ColumnDisplayType.Number],
			['day', 'TINYINT', ColumnDisplayType.Number],
			['dep_time', 'SMALLINT', ColumnDisplayType.Number],
			['sched_dep_time', 'SMALLINT', ColumnDisplayType.Number],
			['dep_delay', 'SMALLINT', ColumnDisplayType.Number],
			['arr_time', 'SMALLINT', ColumnDisplayType.Number],
			['sched_arr_time', 'SMALLINT', ColumnDisplayType.Number],
			['arr_delay', 'SMALLINT', ColumnDisplayType.Number],
			['carrier', 'VARCHAR', ColumnDisplayType.String],
			['flight', 'SMALLINT', ColumnDisplayType.Number],
			['tailnum', 'VARCHAR', ColumnDisplayType.String],
			['origin', 'VARCHAR', ColumnDisplayType.String],
			['dest', 'VARCHAR', ColumnDisplayType.String],
			['air_time', 'SMALLINT', ColumnDisplayType.Number],
			['distance', 'SMALLINT', ColumnDisplayType.Number],
			['hour', 'TINYINT', ColumnDisplayType.Number],
			['minute', 'TINYINT', ColumnDisplayType.Number],
			['time_hour', 'TIMESTAMP_NS', ColumnDisplayType.Datetime],
		];

		assert.deepStrictEqual(result, {
			columns: schemaEntries.map(
				([column_name, type_name, type_display], column_index) => {
					return {
						column_name,
						column_index,
						type_name,
						type_display
					};
				}
			)
		} satisfies TableSchema);
	});

	test('get_data_values formatting', async () => {
		type TestCaseType = [InsertColumn[] | undefined, ColumnValue[][], FormatOptions];

		const testCases: Array<TestCaseType> = [
			// Boolean
			[
				[
					{
						name: 'a',
						type: 'BOOLEAN',
						values: [
							'true', 'false', 'NULL'
						]
					}
				],
				[
					['true', 'false', 0]
				],
				DEFAULT_FORMAT_OPTIONS
			],
			// Integer: special values
			[
				[
					{
						name: 'a',
						type: 'TINYINT',
						values: ['127', '-128', '0', 'NULL']
					},
					{
						name: 'b',
						type: 'SMALLINT',
						values: ['32767', '-32768', '0', 'NULL']
					},
					{
						name: 'c',
						type: 'INTEGER',
						values: ['2147483647', '-2147483648', '0', 'NULL']
					},
					{
						name: 'd',
						type: 'BIGINT',
						values: ['9223372036854775807', '-9223372036854775808', '0', 'NULL']
					},
				],
				[
					['127', '-128', '0', 0],
					['32767', '-32768', '0', 0],
					['2147483647', '-2147483648', '0', 0],
					['9223372036854775807', '-9223372036854775808', '0', 0]
				],
				DEFAULT_FORMAT_OPTIONS
			],
			[
				undefined, // use previous table
				[
					['127', '-128', '0', 0],
					['32,767', '-32,768', '0', 0],
					['2,147,483,647', '-2,147,483,648', '0', 0],
					['9,223,372,036,854,775,807', '-9,223,372,036,854,775,808', '0', 0]
				],
				{ ...DEFAULT_FORMAT_OPTIONS, thousands_sep: ',' }
			],
			// Floating point: special values
			[
				[
					{
						name: 'a',
						type: 'DOUBLE',
						values: [
							'0', '1.125', '0.12345', 'NULL', '\'NaN\'',
							'\'Infinity\'', '\'-Infinity\'',
						]
					},
					{
						name: 'b',
						type: 'FLOAT',
						values: [
							'0', '1.115', '0.12366', 'NULL', '\'NaN\'',
							'\'Infinity\'', '\'-Infinity\'',
						]
					}
				],
				[
					['0.00', '1.13', '0.1235', 0, 2, 10, 11],
					['0.00', '1.12', '0.1237', 0, 2, 10, 11],
				],
				DEFAULT_FORMAT_OPTIONS
			],
			// Floating point: Test thousands separator
			[
				[
					{
						name: 'a',
						type: 'DOUBLE',
						values: [
							'123456789.78', '456789.78'
						]
					}
				],
				[
					['123,456,789.78', '456,789.78']
				],
				{ ...DEFAULT_FORMAT_OPTIONS, thousands_sep: ',' }
			],
			[
				undefined, // use preceding table
				[
					['123_456_789.78', '456_789.78']
				],
				{ ...DEFAULT_FORMAT_OPTIONS, thousands_sep: '_' }
			],
			// Floating point: Scientific notation
			[
				[
					{
						name: 'a',
						type: 'DOUBLE',
						values: [
							'155500', '150000', '15000'
						]
					}
				],
				[
					['1.56e+05', '1.50e+05', '15000.00']
				],
				{ ...DEFAULT_FORMAT_OPTIONS, max_integral_digits: 5 }
			],
			// Varchar: string values truncated
			[
				[
					{
						name: 'a',
						type: 'VARCHAR',
						values: [
							'\'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\'',
							'\'aaaaaaaaaaaaaaaaaaaaaaaaa\'',
							'\'aaaaaaaaaaaa\''
						]
					}
				],
				[
					['aaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaa']
				],
				{ ...DEFAULT_FORMAT_OPTIONS, max_value_length: 20 }
			],
			// Date, Timestamp, Time
			[
				[
					{
						name: 'date0',
						type: 'DATE',
						values: ['\'2023-10-20\'', '\'2024-01-01\'', 'NULL']
					},
					{
						name: 'timestamp0',
						type: 'TIMESTAMP',
						values: ['\'2023-10-20 15:30:00\'', '\'2024-01-01 08:00:00\'', 'NULL']
					},
					{
						name: 'timestamptz0',
						type: 'TIMESTAMP WITH TIME ZONE',
						values: ['\'2023-10-20 15:30:00+00\'', '\'2024-01-01 08:00:00-05\'', 'NULL']
					},
					{
						name: 'time0',
						type: 'TIME',
						values: ['\'13:30:00\'', '\'07:12:34.567\'', 'NULL']
					}
				],
				[
					['2023-10-20', '2024-01-01', 0],
					['2023-10-20 15:30:00', '2024-01-01 08:00:00', 0],
					// Formatted as UTC for consistency across locales
					['2023-10-20 15:30:00+00', '2024-01-01 13:00:00+00', 0],
					['13:30:00', '07:12:34.567', 0]
				],
				DEFAULT_FORMAT_OPTIONS
			],
		];

		let tableName, testInput, testResults, formatOptions;
		for ([testInput, testResults, formatOptions] of testCases) {
			// If testInput is undefined, just reuse the table from the previous test case
			if (testInput !== undefined) {
				tableName = makeTempTableName();
				await createTempTable(tableName, testInput);
			}
			const data = await getAllDataValues(tableName!, formatOptions);
			assert.deepStrictEqual(data,
				{
					columns: testResults
				}
			);
		}
	});
});
