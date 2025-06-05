/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
	ColumnSortKey,
	ColumnValue,
	DataExplorerBackendRequest,
	DataExplorerResponse,
	DataExplorerRpc,
	ExportFormat,
	FilterComparisonOp,
	FormatOptions,
	GetDataValuesParams,
	GetSchemaParams,
	RowFilter,
	RowFilterCondition,
	RowFilterParams,
	RowFilterType,
	Selection,
	SetRowFiltersParams,
	SupportStatus,
	TableData,
	TableSchema,
	TableSelectionKind,
	TextSearchType,
	ColumnHistogramParams,
	ColumnHistogramParamsMethod,
	GetColumnProfilesParams,
	ColumnHistogram
} from '../interfaces';
import { randomBytes, randomUUID } from 'crypto';

const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 9,
	max_value_length: 100
};

// Not sure why it is not possible to use Mocha's 'before' for this
async function activateExtension() {
	// Ensure the extension is activated
	await vscode.extensions.getExtension('positron.positron-duckdb')?.activate();
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
	} else {
		// may be undefined if the result type is void
		return resp.result;
	}
}

function makeTempTableName(): string {
	return `positron_${randomUUID().replace(/-/g, '')}`;
}

type InsertColumn = {
	name: string;
	type: string;
	display_type?: ColumnDisplayType;
	values: Array<string>;
};

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
		params: { uri: vscode.Uri.from({ scheme: 'duckdb', path: tableName }) }
	});
}

async function createTableAsSelect(tableName: string, query: string) {
	await runQuery(`CREATE TABLE ${tableName} AS ${query};`);

	// Now set up the new table so it will respond to RPCs with a duckdb://${tableName} prefix
	await dxExec({
		method: DataExplorerBackendRequest.OpenDataset,
		params: { uri: vscode.Uri.from({ scheme: 'duckdb', path: tableName }) }
	});
}

async function getState(uri: vscode.Uri): Promise<BackendState> {
	return dxExec({
		method: DataExplorerBackendRequest.GetState,
		uri: uri.toString(),
		params: {}
	});
}

async function getSchema(tableName: string) {
	const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
	const state = await getState(uri);
	const shape = state.table_shape;
	return dxExec({
		method: DataExplorerBackendRequest.GetSchema,
		uri: uri.toString(),
		params: {
			column_indices: Array.from({ length: shape.num_columns }, (_, index) => index)
		} satisfies GetSchemaParams
	}) as Promise<TableSchema>;
}

function generateRandomString(length: number) {
	return randomBytes(length)
		.toString('base64')
		.replace(/[^a-zA-Z0-9]/g, '')
		.slice(0, length);
}

async function getAllDataValues(tableName: string, formatOptions?: FormatOptions) {
	const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
	const state = await getState(uri);
	const shape = state.table_shape;
	return dxExec({
		method: DataExplorerBackendRequest.GetDataValues,
		uri: uri.toString(),
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

	const flightParquet = path.join(__dirname, 'data', 'flights.parquet');

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
		const uri = vscode.Uri.file(flightParquet);

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
					supported_types: Object.values(ColumnProfileType).map((value) => {
						return { profile_type: value, support_status: SupportStatus.Supported };
					})
				},
				set_sort_columns: { support_status: SupportStatus.Supported, },
				export_data_selection: {
					support_status: SupportStatus.Supported,
					supported_formats: [
						ExportFormat.Csv,
						ExportFormat.Tsv,
						ExportFormat.Html
					]
				}
			}
		} satisfies BackendState);


		result = await dxExec({
			method: DataExplorerBackendRequest.GetSchema,
			uri: uri.toString(),
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

	type TestCaseType = [InsertColumn[] | undefined, ColumnValue[][], FormatOptions];

	test('get_data_values formatting', async () => {

		const testCases: Array<TestCaseType> = [
			// Boolean
			[
				[
					{
						name: 'a',
						type: 'BOOLEAN',
						display_type: ColumnDisplayType.Boolean,
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
						display_type: ColumnDisplayType.Number,
						values: ['127', '-128', '0', 'NULL']
					},
					{
						name: 'b',
						type: 'SMALLINT',
						display_type: ColumnDisplayType.Number,
						values: ['32767', '-32768', '0', 'NULL']
					},
					{
						name: 'c',
						type: 'INTEGER',
						display_type: ColumnDisplayType.Number,
						values: ['2147483647', '-2147483648', '0', 'NULL']
					},
					{
						name: 'd',
						type: 'BIGINT',
						display_type: ColumnDisplayType.Number,
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
						display_type: ColumnDisplayType.Number,
						values: [
							'0', '1.125', '0.12345', 'NULL', '\'NaN\'',
							'\'Infinity\'', '\'-Infinity\'',
						]
					},
					{
						name: 'b',
						type: 'FLOAT',
						display_type: ColumnDisplayType.Number,
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
						display_type: ColumnDisplayType.Number,
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
						display_type: ColumnDisplayType.Number,
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
						display_type: ColumnDisplayType.String,
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
						display_type: ColumnDisplayType.Date,
						values: ['\'2023-10-20\'', '\'2024-01-01\'', 'NULL']
					},
					{
						name: 'timestamp0',
						type: 'TIMESTAMP',
						display_type: ColumnDisplayType.Datetime,
						values: ['\'2023-10-20 15:30:00\'', '\'2024-01-01 08:00:00\'', 'NULL']
					},
					{
						name: 'timestamptz0',
						type: 'TIMESTAMP WITH TIME ZONE',
						display_type: ColumnDisplayType.Datetime,
						values: ['\'2023-10-20 15:30:00+00\'', '\'2024-01-01 08:00:00-05\'', 'NULL']
					},
					{
						name: 'time0',
						type: 'TIME',
						display_type: ColumnDisplayType.Time,
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
			// Decimal types
			[
				[
					{
						name: 'decimal_default',
						type: 'DECIMAL',
						display_type: ColumnDisplayType.Number,
						values: ['1.23', '45.67', '89.01', 'NULL']
					},
					{
						name: 'decimal_precision',
						type: 'DECIMAL(10)', // same as DECIMAL(10,0)
						display_type: ColumnDisplayType.Number,
						values: ['123456', '987654', '555555', 'NULL']
					},
					{
						name: 'decimal_precision_scale',
						type: 'DECIMAL(10,2)',
						display_type: ColumnDisplayType.Number,
						values: ['123.456', '789.012', '345.678', 'NULL']
					}
				],
				[
					['1.230', '45.670', '89.010', 0],
					['123456', '987654', '555555', 0],
					['123.46', '789.01', '345.68', 0]
				],
				DEFAULT_FORMAT_OPTIONS
			]
		];

		let tableName, testInput, testResults, formatOptions;
		for ([testInput, testResults, formatOptions] of testCases) {
			// If testInput is undefined, just reuse the table from the previous test case
			if (testInput === undefined) {
				continue;
			}

			tableName = makeTempTableName();
			await createTempTable(tableName, testInput);

			const fullSchema = await getSchema(tableName!);

			// Check that returned schema matches display types in testInput
			for (let i = 0; i < testInput.length; i++) {
				const schema = fullSchema.columns[i];
				assert.strictEqual(schema.column_name, testInput[i].name);
				assert.strictEqual(schema.type_display, testInput[i].display_type);
			}

			const data = await getAllDataValues(tableName!, formatOptions);
			assert.deepStrictEqual(data,
				{
					columns: testResults
				}
			);
		}
	});

	test('export_data_selection works correctly', async () => {
		const tableName = makeTempTableName();

		const longString = generateRandomString(1000);

		// Create a test table with mixed data types for comprehensive testing
		await createTempTable(tableName, [
			{
				name: 'int_col',
				type: 'INTEGER',
				values: ['1', '2', '3', '4', 'NULL']
			},
			{
				name: 'str_col',
				type: 'VARCHAR',
				values: ['\'a\'', '\'b\'', '\'c\'', 'NULL', '\'' + longString + '\'']
			},
			{
				name: 'float_col',
				type: 'DOUBLE',
				values: ['1.1', '2.2', '3.3', 'NULL', '5.5E20']
			},
			{
				name: 'date0',
				type: 'DATE',
				values: ['\'2023-10-20\'', '\'2024-01-01\'', 'NULL', '\'2024-01-02\'', 'NULL']
			},
			{
				name: 'timestamp0',
				type: 'TIMESTAMP',
				values: ['\'2023-10-20 15:30:00\'', '\'2024-01-01 08:00:00\'', 'NULL',
					'\'2024-01-02 12:00:00\'', 'NULL']
			},
			{
				name: 'timestamptz0',
				type: 'TIMESTAMP WITH TIME ZONE',
				values: ['\'2023-10-20 15:30:00+00\'', '\'2024-01-01 08:00:00-05\'', 'NULL',
					'\'2024-01-02 12:00:00+01\'', 'NULL']
			},
			{
				name: 'time0',
				type: 'TIME',
				values: ['\'13:30:00\'', '\'07:12:34.567\'', 'NULL', '\'12:00:00\'', 'NULL']
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		const testSelection = async (kind: TableSelectionKind, selection: Selection, expected: string,
			format: ExportFormat = ExportFormat.Csv
		) => {
			const result = await dxExec({
				method: DataExplorerBackendRequest.ExportDataSelection,
				uri: uri.toString(),
				params: {
					selection: {
						kind,
						selection
					},
					format
				}
			});
			assert.strictEqual(result.data, expected);
		};

		const testSingleCell = async (row: number, col: number, expected: string) => {
			await testSelection(TableSelectionKind.SingleCell,
				{
					row_index: row,
					column_index: col
				}, expected
			);
		};


		const cellTestCases = [
			// INTEGER
			{ row: 0, col: 0, expected: '1' },
			{ row: 1, col: 0, expected: '2' },
			{ row: 4, col: 0, expected: 'NULL' },

			// VARCHAR
			{ row: 2, col: 1, expected: 'c' },
			{ row: 3, col: 1, expected: 'NULL' },
			{ row: 4, col: 1, expected: longString },

			// DOUBLE
			{ row: 3, col: 2, expected: 'NULL' },
			{ row: 4, col: 2, expected: '5.5e+20' },

			// Date type
			{ row: 0, col: 3, expected: '2023-10-20' },
			{ row: 1, col: 3, expected: '2024-01-01' },
			{ row: 2, col: 3, expected: 'NULL' },

			// Timestamp type
			{ row: 0, col: 4, expected: '2023-10-20 15:30:00' },
			{ row: 1, col: 4, expected: '2024-01-01 08:00:00' },
			{ row: 2, col: 4, expected: 'NULL' },

			// Timestamp with timezone type
			{ row: 0, col: 5, expected: '2023-10-20 15:30:00+00' },
			{ row: 1, col: 5, expected: '2024-01-01 13:00:00+00' },
			{ row: 2, col: 5, expected: 'NULL' },

			// Time type
			{ row: 0, col: 6, expected: '13:30:00' },
			{ row: 1, col: 6, expected: '07:12:34.567' },
			{ row: 2, col: 6, expected: 'NULL' }
		];

		// Run all test cases
		for (const { row, col, expected } of cellTestCases) {
			await testSingleCell(row, col, expected);
		}

		const testCellRange = async (firstRow: number, lastRow: number, firstCol: number,
			lastCol: number, expected: string) => {
			await testSelection(TableSelectionKind.CellRange,
				{
					first_row_index: firstRow,
					last_row_index: lastRow,
					first_column_index: firstCol,
					last_column_index: lastCol
				},
				expected
			);
		};

		await testCellRange(0, 1, 0, 1, 'int_col,str_col\n1,a\n2,b');
		await testCellRange(0, 2, 0, 2, 'int_col,str_col,float_col\n1,a,1.1\n2,b,2.2\n3,c,3.3');

		// Test RowRange selection
		const testRowRange = async (firstRow: number, lastRow: number, expected: string) => {
			await testSelection(TableSelectionKind.RowRange,
				{
					first_index: firstRow,
					last_index: lastRow
				},
				expected
			);
		};

		await testRowRange(1, 2, `int_col,str_col,float_col,date0,timestamp0,timestamptz0,time0
2,b,2.2,2024-01-01,2024-01-01 08:00:00,2024-01-01 13:00:00+00,07:12:34.567
3,c,3.3,NULL,NULL,NULL,NULL`);

		// Test ColumnRange selection
		const testColRange = async (firstCol: number, lastCol: number, expected: string) => {
			await testSelection(TableSelectionKind.ColumnRange,
				{
					first_index: firstCol,
					last_index: lastCol
				},
				expected
			);
		};

		await testColRange(0, 1, `int_col,str_col\n1,a\n2,b\n3,c\n4,NULL\nNULL,${longString}`);

		// Test RowIndices selection
		const testRowIndices = async (indices: number[], expected: string) => {
			await testSelection(TableSelectionKind.RowIndices, { indices }, expected);
		};
		await testRowIndices([1, 3], `int_col,str_col,float_col,date0,timestamp0,timestamptz0,time0
2,b,2.2,2024-01-01,2024-01-01 08:00:00,2024-01-01 13:00:00+00,07:12:34.567
4,NULL,NULL,2024-01-02,2024-01-02 12:00:00,2024-01-02 11:00:00+00,12:00:00`);

		// Test ColumnIndices selection
		const testColumnIndices = async (indices: number[], expected: string) => {
			await testSelection(TableSelectionKind.ColumnIndices, { indices }, expected);
		};
		await testColumnIndices([0, 2], 'int_col,float_col\n1,1.1\n2,2.2\n3,3.3\n4,NULL\nNULL,5.5e+20');

		// Test TSV format
		await testSelection(TableSelectionKind.CellRange,
			{
				first_row_index: 0,
				last_row_index: 1,
				first_column_index: 0,
				last_column_index: 1
			},
			'int_col\tstr_col\n1\ta\n2\tb',
			ExportFormat.Tsv
		);

		// Test HTML format
		await testSelection(TableSelectionKind.CellRange,
			{
				first_row_index: 0,
				last_row_index: 1,
				first_column_index: 0,
				last_column_index: 1
			},
			'<tr><td>int_col</td><td>str_col</td></tr>\n<tr><td>1</td><td>a</td></tr>\n<tr><td>2</td><td>b</td></tr>',
			ExportFormat.Html
		);
	});

	test('set_row_filters works correctly', async () => {
		const tableName = makeTempTableName();

		const selectExprs = `*,
		dep_time > 630 AS dep_time_after_630,
		CASE WHEN dep_time % 2 = 0 THEN NULL ELSE dep_time END AS dep_time_odd_only,
		CASE WHEN carrier = 'DL' THEN '' ELSE carrier END AS carrier_with_empties
		`;

		const selectQuery = `SELECT ${selectExprs}
		FROM parquet_scan('${flightParquet}') LIMIT 1000`;

		await createTableAsSelect(tableName, selectQuery);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		const origState = await getState(uri);

		// Row filters have the schema attached
		const fullSchema = await getSchema(tableName);
		const nameToSchema = new Map<string, ColumnSchema>(
			fullSchema.columns.map((column) => [column.column_name, column])
		);

		// We use these column schemas below
		const dep_time = nameToSchema.get('dep_time')!;
		const dep_time_after_630 = nameToSchema.get('dep_time_after_630')!;
		const dep_time_odd_only = nameToSchema.get('dep_time_odd_only')!;
		const carrier = nameToSchema.get('carrier')!;
		const carrier_with_empties = nameToSchema.get('carrier_with_empties')!;
		const tailnum = nameToSchema.get('tailnum')!;

		const getFilter = (
			columnSchema: ColumnSchema,
			filter_type: RowFilterType,
			params?: RowFilterParams
		): RowFilter => {
			return {
				filter_id: 'placeholder',
				condition: RowFilterCondition.And,
				column_schema: columnSchema,
				filter_type,
				params
			};
		};

		const getCompare = (columnSchema: ColumnSchema, op: FilterComparisonOp, value: string) => {
			return getFilter(columnSchema, RowFilterType.Compare, { op, value });
		};

		const getTextSearch = (
			columnSchema: ColumnSchema,
			searchType: TextSearchType,
			term: string,
			caseSensitive: boolean = true
		) => {
			return getFilter(
				columnSchema,
				RowFilterType.Search,
				{ search_type: searchType, term, case_sensitive: caseSensitive }
			);
		};

		// Specify filters and the expected where clause, which we will use to check the results
		// are as expected
		type FilterCaseType = [RowFilter[], string];
		const filterCases: Array<FilterCaseType> = [
			// Compare: simple cases
			...Object.values(FilterComparisonOp).map((op): FilterCaseType => {
				return [[getCompare(dep_time, op, '656')], `dep_time ${op} 656`];
			}),
			// Compare: multiple conditions
			[
				[
					getCompare(dep_time, FilterComparisonOp.Gt, '615'),
					getCompare(dep_time, FilterComparisonOp.Lt, '645')
				],
				`dep_time > 615 AND dep_time < 645`
			],
			// Between, NotBetween
			[
				[
					getFilter(dep_time, RowFilterType.Between, { left_value: '615', right_value: '645' })
				],
				'dep_time BETWEEN 615 AND 645'
			],
			[
				[
					getFilter(dep_time, RowFilterType.NotBetween, { left_value: '615', right_value: '645' })
				],
				'NOT (dep_time BETWEEN 615 AND 645)'
			],
			// IsNull, NotNull
			[
				[getFilter(dep_time_odd_only, RowFilterType.IsNull)],
				'dep_time_odd_only IS NULL'
			],
			[
				[getFilter(dep_time_odd_only, RowFilterType.NotNull)],
				'dep_time_odd_only IS NOT NULL'
			],
			// IsEmpty, NotEmpty
			[
				[getFilter(carrier_with_empties, RowFilterType.IsEmpty)],
				'carrier_with_empties = \'\''
			],
			[
				[getFilter(carrier_with_empties, RowFilterType.NotEmpty)],
				'carrier_with_empties <> \'\''
			],
			// IsTrue, IsFalse
			[
				[getFilter(dep_time_after_630, RowFilterType.IsTrue)],
				'dep_time_after_630 = true'
			],
			[
				[getFilter(dep_time_after_630, RowFilterType.IsFalse)],
				'dep_time_after_630 = false'
			],
			// Search
			[
				[getTextSearch(tailnum, TextSearchType.StartsWith, 'N5')],
				'tailnum LIKE \'N5%\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.StartsWith, 'n5', false)],
				'lower(tailnum) LIKE \'n5%\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.EndsWith, 'B')],
				'tailnum LIKE \'%B\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.EndsWith, 'b', false)],
				'lower(tailnum) LIKE \'%b\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.Contains, '6U')],
				'tailnum LIKE \'%6U%\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.Contains, '6u', false)],
				'lower(tailnum) LIKE \'%6u%\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.NotContains, '6U')],
				'tailnum NOT LIKE \'%6U%\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.NotContains, '6u', false)],
				'lower(tailnum) NOT LIKE \'%6u%\''
			],
			[
				[getTextSearch(tailnum, TextSearchType.RegexMatch, 'N5.*B')],
				'regexp_matches(tailnum, \'N5.*B\')'
			],
			[
				[getTextSearch(tailnum, TextSearchType.RegexMatch, 'n5.*b', false)],
				'regexp_matches(tailnum, \'n5.*b\', \'i\')'
			],
			// SetMembership
			[
				[getFilter(carrier, RowFilterType.SetMembership, { values: ['UA', 'AA', 'DL'], inclusive: true })],
				'carrier IN [\'UA\', \'AA\', \'DL\']'
			],
			[
				[getFilter(carrier, RowFilterType.SetMembership, { values: ['UA', 'AA', 'DL'], inclusive: false })],
				'carrier NOT IN [\'UA\', \'AA\', \'DL\']'
			],
		];

		for (const [filters, whereClause] of filterCases) {
			// reset to no filters
			await dxExec({
				method: DataExplorerBackendRequest.SetRowFilters,
				uri: uri.toString(),
				params: { filters: [] }
			});

			// Check that reset back to original state
			let currentState = await getState(uri);
			assert.deepStrictEqual(currentState, origState);

			await dxExec({
				method: DataExplorerBackendRequest.SetRowFilters,
				uri: uri.toString(),
				params: {
					filters
				} satisfies SetRowFiltersParams
			});

			// Check that new filters are returned from get_state
			currentState = await getState(uri);
			assert.deepStrictEqual(currentState.row_filters, filters);

			const expectedTableName = makeTempTableName();
			await createTableAsSelect(
				expectedTableName,
				`SELECT * FROM (${selectQuery}) t WHERE ${whereClause}`
			);

			const resultData = await getAllDataValues(tableName);
			const expectedData = await getAllDataValues(expectedTableName);
			assert.deepStrictEqual(resultData, expectedData);
		}
	});

	test('row filter with zero matching rows works correctly', async () => {
		// Create a simple table with known data for precise zero-row testing
		const tableName = makeTempTableName();

		await createTempTable(tableName, [
			{
				name: 'id',
				type: 'INTEGER',
				display_type: ColumnDisplayType.Number,
				values: ['1', '2', '3', '4', '5']
			},
			{
				name: 'name',
				type: 'VARCHAR',
				display_type: ColumnDisplayType.String,
				values: ['\'Alice\'', '\'Bob\'', '\'Charlie\'', '\'David\'', '\'Eve\'']
			},
			{
				name: 'value',
				type: 'DOUBLE',
				display_type: ColumnDisplayType.Number,
				values: ['10.5', '20.75', '30.25', '40.5', '50.0']
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Get original state for reference
		const origState = await getState(uri);
		assert.strictEqual(origState.table_shape.num_rows, 5);

		// Get schema for filter construction
		const fullSchema = await getSchema(tableName);
		const nameToSchema = new Map<string, ColumnSchema>(
			fullSchema.columns.map((column) => [column.column_name, column])
		);
		const idColumn = nameToSchema.get('id')!;

		// Filter that will match no rows (id > 100)
		const zeroRowFilter: RowFilter = {
			filter_id: 'zero-row-filter',
			condition: RowFilterCondition.And,
			column_schema: idColumn,
			filter_type: RowFilterType.Compare,
			params: { op: FilterComparisonOp.Gt, value: '100' }
		};

		// Apply the filter
		const filterResult = await dxExec({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: uri.toString(),
			params: { filters: [zeroRowFilter] } satisfies SetRowFiltersParams
		});

		// Check that filter result shows 0 rows
		assert.strictEqual(filterResult.selected_num_rows, 0);

		// Check that get_state also shows 0 rows
		const filteredState = await getState(uri);
		assert.strictEqual(filteredState.table_shape.num_rows, 0);
		assert.strictEqual(filteredState.table_unfiltered_shape.num_rows, 5);

		// Test that getDataValues returns empty columns
		const data = await getAllDataValues(tableName);
		assert.deepStrictEqual(data, {
			columns: [[], [], []]
		});

		// Test with different column selections
		const testSpecificColumns = async () => {
			return dxExec({
				method: DataExplorerBackendRequest.GetDataValues,
				uri: uri.toString(),
				params: {
					columns: [
						{
							column_index: 0, // id column
							spec: { first_index: 0, last_index: 4 }
						},
						{
							column_index: 2, // value column
							spec: { first_index: 0, last_index: 4 }
						}
					],
					format_options: DEFAULT_FORMAT_OPTIONS
				} satisfies GetDataValuesParams
			}) as Promise<TableData>;
		};

		const specificColumnsData = await testSpecificColumns();
		assert.deepStrictEqual(specificColumnsData, {
			columns: [[], []]
		});

		// Test with indices instead of ranges
		const testIndicesSelection = async () => {
			return dxExec({
				method: DataExplorerBackendRequest.GetDataValues,
				uri: uri.toString(),
				params: {
					columns: [
						{
							column_index: 1, // name column
							spec: { indices: [0, 2, 4] }
						}
					],
					format_options: DEFAULT_FORMAT_OPTIONS
				} satisfies GetDataValuesParams
			}) as Promise<TableData>;
		};

		const indicesData = await testIndicesSelection();
		assert.deepStrictEqual(indicesData, {
			columns: [[]]
		});

		// Remove the filter and verify data comes back
		await dxExec({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: uri.toString(),
			params: { filters: [] }
		});

		const unfilterState = await getState(uri);
		assert.deepStrictEqual(unfilterState, origState);

		const unfilteredData = await getAllDataValues(tableName);
		assert.strictEqual(unfilteredData.columns.length, 3);
		assert.strictEqual(unfilteredData.columns[0].length, 5);
	});

	test('set_sort_columns works correctly', async () => {
		const tableName = makeTempTableName();

		// DuckDB sorts are not stable, so we introduce a row_index auxiliary field to make stable
		const selectQuery = `SELECT *, ROW_NUMBER() OVER() AS row_index
		FROM parquet_scan('${flightParquet}') LIMIT 1000`;

		await createTableAsSelect(tableName, selectQuery);
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		const fullSchema = await getSchema(tableName);
		assert.deepStrictEqual(fullSchema.columns[9].column_name, 'carrier');

		type SortCaseType = [ColumnSortKey[], string];
		const sortCases: Array<SortCaseType> = [
			[
				[
					{
						column_index: 9,  // carrier
						ascending: true
					}
				],
				'carrier'
			],
			[
				[
					{
						column_index: 9,  // carrier
						ascending: false
					}
				],
				'carrier DESC'
			],
			[
				[
					{
						column_index: 9,  // carrier
						ascending: true
					},
					{
						column_index: 5,  // dep_delay
						ascending: true
					},
				],
				'carrier, dep_delay'
			],
			[
				[
					{
						column_index: 9,  // carrier
						ascending: false
					},
					{
						column_index: 5,  // dep_delay
						ascending: false
					},
				],
				'carrier DESC, dep_delay DESC'
			],
		];

		for (const [sort_keys, sortClause] of sortCases) {
			// reset to no filters
			await dxExec({
				method: DataExplorerBackendRequest.SetSortColumns,
				uri: uri.toString(),
				params: { sort_keys: [] }
			});

			// Check that reset back to original state
			let currentState = await getState(uri);
			assert.deepStrictEqual(currentState.sort_keys, []);

			const stableSortKeys = [
				...sort_keys,
				{ column_index: fullSchema.columns.length - 1, ascending: true }
			];

			await dxExec({
				method: DataExplorerBackendRequest.SetSortColumns,
				uri: uri.toString(),
				params: { sort_keys: stableSortKeys }
			});

			// Check that new state is correct
			currentState = await getState(uri);
			assert.deepStrictEqual(currentState.sort_keys, stableSortKeys);

			const expectedTableName = makeTempTableName();
			await createTableAsSelect(
				expectedTableName,
				`SELECT * FROM (${selectQuery}) t ORDER BY ${sortClause}, row_index`
			);

			const resultData = await getAllDataValues(tableName);
			const expectedData = await getAllDataValues(expectedTableName);
			assert.deepStrictEqual(resultData, expectedData);
		}
	});

	/**
	 * Creates a test table with numeric data for histogram testing
	 * @param valueType The SQL type of the value column
	 * @param valueGenerator A function that generates values for the test data
	 * @returns The name of the created table
	 */
	async function createHistogramTestTable(
		valueType: string,
		valueGenerator: (index: number) => string,
		rowCount: number = 100
	): Promise<string> {
		const tableName = makeTempTableName();
		await createTempTable(tableName, [
			{
				name: 'value',
				type: valueType,
				values: Array.from({ length: rowCount }, (_, i) => valueGenerator(i))
			}
		]);
		return tableName;
	}

	/**
	 * Requests a histogram for a column and returns the result
	 * @param tableName The name of the table containing the data
	 * @param columnIndex The index of the column to profile
	 * @param histogramParams The parameters for the histogram
	 * @param callbackId A unique ID for this histogram request
	 * @returns The histogram result
	 */
	async function requestHistogram(
		tableName: string,
		columnIndex: number,
		histogramParams: ColumnHistogramParams,
		callbackId: string
	): Promise<ColumnHistogram> {
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Create a promise that will resolve when we receive the column profile event
		let resolveProfilePromise: (value: any) => void;
		const profilePromise = new Promise<any>(resolve => {
			resolveProfilePromise = resolve;
		});

		// Set up event listener for the column profile results
		const disposable = vscode.commands.registerCommand(
			'positron-data-explorer.sendUiEvent',
			(event: any) => {
				if (event.method === 'return_column_profiles' &&
					event.params.callback_id === callbackId) {
					resolveProfilePromise(event.params);
					disposable.dispose();
				}
			}
		);

		// Add a timeout to prevent tests from hanging indefinitely
		const timeoutId = setTimeout(() => {
			disposable.dispose();
			resolveProfilePromise({
				error: `Timeout waiting for histogram data for callback_id: ${callbackId}`
			});
		}, 5000); // 5 second timeout

		try {
			// Request a histogram
			await dxExec({
				method: DataExplorerBackendRequest.GetColumnProfiles,
				uri: uri.toString(),
				params: {
					callback_id: callbackId,
					profiles: [
						{
							column_index: columnIndex,
							profiles: [
								{
									profile_type: ColumnProfileType.LargeHistogram,
									params: histogramParams
								},
								{
									profile_type: ColumnProfileType.SummaryStats
								}
							]
						}
					],
					format_options: DEFAULT_FORMAT_OPTIONS
				} satisfies GetColumnProfilesParams
			});

			// Wait for the profile results
			const profileResults = await profilePromise;

			// Clear the timeout since we got a response
			clearTimeout(timeoutId);

			// Check for timeout error
			if (profileResults.error) {
				throw new Error(profileResults.error);
			}

			// Return the histogram from the profile results
			const profile = profileResults.profiles[0];
			if (profile && profile.large_histogram) {
				return profile.large_histogram as ColumnHistogram;
			}

			throw new Error(`No histogram returned for column ${columnIndex}`);
		} catch (error) {
			// Clean up in case of error
			disposable.dispose();
			clearTimeout(timeoutId);
			throw error;
		}
	}

	test('ColumnProfileEvaluator.computeHistogram - Fixed binning method', async () => {
		// Create a test table with numeric data
		const tableName = await createHistogramTestTable(
			'INTEGER',
			(i) => `${i + 1}` // Values 1 to 100
		);

		// Request a histogram with fixed binning method
		const histogram = await requestHistogram(
			tableName,
			0, // column index
			{
				method: ColumnHistogramParamsMethod.Fixed,
				num_bins: 10
			} as ColumnHistogramParams,
			'test-fixed-binning'
		);

		// Verify the histogram
		assert.ok(histogram, 'Histogram should be returned');
		assert.strictEqual(histogram.bin_edges.length, 11, 'Should have 11 bin edges for 10 bins');
		assert.strictEqual(histogram.bin_counts.length, 10, 'Should have 10 bin counts');

		// Verify bin edges are evenly spaced for fixed binning
		const firstEdge = parseFloat(histogram.bin_edges[0]);
		const lastEdge = parseFloat(histogram.bin_edges[histogram.bin_edges.length - 1]);
		const expectedBinWidth = (lastEdge - firstEdge) / 10;

		// Check that the first bin edge is approximately equal to the minimum value (1)
		assert.ok(Math.abs(firstEdge - 1) < 0.001,
			`First bin edge should be approximately equal to the minimum value, got ${firstEdge}`);

		// Check that bin edges are approximately evenly spaced
		for (let i = 1; i < histogram.bin_edges.length; i++) {
			const edge1 = parseFloat(histogram.bin_edges[i - 1]);
			const edge2 = parseFloat(histogram.bin_edges[i]);
			const actualWidth = edge2 - edge1;
			assert.ok(
				Math.abs(actualWidth - expectedBinWidth) < 0.001,
				`Bin edges should be evenly spaced, expected width ${expectedBinWidth}, got ${actualWidth}`
			);
		}
	});

	test('ColumnProfileEvaluator.computeHistogram - Freedman-Diaconis method', async () => {
		// Create a test table with numeric data
		const tableName = await createHistogramTestTable(
			'DOUBLE',
			(i) => `${i * 0.5}` // Values 0, 0.5, 1.0, ...
		);

		// Request a histogram with Freedman-Diaconis binning method
		const histogram = await requestHistogram(
			tableName,
			0, // column index
			{
				method: ColumnHistogramParamsMethod.FreedmanDiaconis,
				num_bins: 20
			} as ColumnHistogramParams,
			'test-freedman-diaconis'
		);

		// Verify the histogram
		assert.ok(histogram, 'Histogram should be returned');
		assert.ok(histogram.bin_edges.length > 1, 'Should have multiple bin edges');
		assert.strictEqual(histogram.bin_edges.length, histogram.bin_counts.length + 1,
			'Should have one more bin edge than bin counts');

		// Check that the first bin edge is approximately equal to the minimum value (0)
		const firstEdge = parseFloat(histogram.bin_edges[0]);
		assert.ok(Math.abs(firstEdge - 0) < 0.001,
			`First bin edge should be approximately equal to the minimum value, got ${firstEdge}`);
	});

	test('ColumnProfileEvaluator.computeHistogram - Sturges method', async () => {
		// Create a test table with numeric data
		const tableName = await createHistogramTestTable(
			'INTEGER',
			(i) => `${i * 2}` // Even values 0, 2, 4, ...
		);

		// Request a histogram with Sturges binning method
		const histogram = await requestHistogram(
			tableName,
			0, // column index
			{
				method: ColumnHistogramParamsMethod.Sturges,
				num_bins: 15
			} as ColumnHistogramParams,
			'test-sturges'
		);

		// Verify the histogram
		assert.ok(histogram, 'Histogram should be returned');
		assert.ok(histogram.bin_edges.length > 1, 'Should have multiple bin edges');
		assert.strictEqual(histogram.bin_edges.length, histogram.bin_counts.length + 1,
			'Should have one more bin edge than bin counts');

		// Check that the first bin edge is approximately equal to the minimum value (0)
		const firstEdge = parseFloat(histogram.bin_edges[0]);
		assert.ok(Math.abs(firstEdge - 0) < 0.001,
			`First bin edge should be approximately equal to the minimum value, got ${firstEdge}`);
	});

	test('ColumnProfileEvaluator.computeHistogram - Edge case: all null values', async () => {
		// Create a test table with all null values
		const tableName = await createHistogramTestTable(
			'INTEGER',
			() => 'NULL', // All NULL values
			10 // 10 rows
		);

		// Request a histogram for the column with all null values
		const histogram = await requestHistogram(
			tableName,
			0, // column index
			{
				method: ColumnHistogramParamsMethod.Fixed,
				num_bins: 10
			} as ColumnHistogramParams,
			'test-all-null'
		);

		// Verify the histogram for all null values
		assert.ok(histogram, 'Histogram should be returned');
		assert.strictEqual(histogram.bin_edges.length, 2, 'Should have 2 bin edges for all null values');
		assert.strictEqual(histogram.bin_edges[0], 'NULL', 'First bin edge should be NULL');
		assert.strictEqual(histogram.bin_edges[1], 'NULL', 'Second bin edge should be NULL');
		assert.strictEqual(histogram.bin_counts.length, 1, 'Should have 1 bin count');
		assert.strictEqual(histogram.bin_counts[0], 10, 'Bin count should equal number of rows');
	});

	test('ColumnProfileEvaluator.computeHistogram - Edge case: single value', async () => {
		// Create a test table with a single value repeated
		const tableName = await createHistogramTestTable(
			'INTEGER',
			() => '42', // All values are 42
			10 // 10 rows
		);

		// Request a histogram for the column with a single value
		const histogram = await requestHistogram(
			tableName,
			0, // column index
			{
				method: ColumnHistogramParamsMethod.Fixed,
				num_bins: 10
			} as ColumnHistogramParams,
			'test-single-value'
		);

		// Verify the histogram for a single value
		assert.ok(histogram, 'Histogram should be returned');
		assert.strictEqual(histogram.bin_edges.length, 2, 'Should have 2 bin edges for single value');
		assert.strictEqual(histogram.bin_counts.length, 1, 'Should have 1 bin count');
		assert.strictEqual(histogram.bin_counts[0], 10, 'Bin count should equal number of rows');

		// For a single value, the bin edges should be equal
		const firstEdge = parseFloat(histogram.bin_edges[0]);
		const secondEdge = parseFloat(histogram.bin_edges[1]);
		assert.ok(Math.abs(firstEdge - secondEdge) < 0.001,
			'Bin edges should be equal for single value');

		// The single value should be 42
		assert.ok(Math.abs(firstEdge - 42) < 0.001,
			`First bin edge should be approximately equal to the single value (42), got ${firstEdge}`);
	});
});
