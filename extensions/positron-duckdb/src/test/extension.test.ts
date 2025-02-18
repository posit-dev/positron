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
	TableSelection,
	TableSelectionKind,
	TextSearchType
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

async function createTableAsSelect(tableName: string, query: string) {
	await runQuery(`CREATE TABLE ${tableName} AS ${query};`);

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

async function getSchema(tableName: string, formatOptions?: FormatOptions) {
	const uri = `duckdb://${tableName}`;
	const state = await getState(uri);
	const shape = state.table_shape;
	return dxExec({
		method: DataExplorerBackendRequest.GetSchema,
		uri,
		params: {
			column_indices: Array.from({ length: shape.num_columns }, (_, index) => index)
		} satisfies GetSchemaParams
	}) as Promise<TableSchema>;
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
		const uri = flightParquet;

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

	test('export_data_selection works correctly', async () => {
		const tableName = makeTempTableName();

		// Create a test table with mixed data types for comprehensive testing
		await createTempTable(tableName, [
			{
				name: 'int_col',
				type: 'INTEGER',
				values: ['1', '2', '3', '4', '5']
			},
			{
				name: 'str_col',
				type: 'VARCHAR',
				values: ['\'a\'', '\'b\'', '\'c\'', '\'d\'', '\'e\'']
			},
			{
				name: 'float_col',
				type: 'DOUBLE',
				values: ['1.1', '2.2', '3.3', '4.4', '5.5']
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

		const uri = `duckdb://${tableName}`;

		const testSelection = async (kind: TableSelectionKind, selection: Selection, expected: string,
			format: ExportFormat = ExportFormat.Csv
		) => {
			const result = await dxExec({
				method: DataExplorerBackendRequest.ExportDataSelection,
				uri,
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
			// Number and string types
			{ row: 0, col: 0, expected: '1' },
			{ row: 1, col: 0, expected: '2' },
			{ row: 2, col: 1, expected: 'c' },
			{ row: 3, col: 2, expected: '4.4' },

			// Date type
			{ row: 0, col: 3, expected: '2023-10-20' },
			{ row: 1, col: 3, expected: '2024-01-01' },
			{ row: 2, col: 3, expected: '' },

			// Timestamp type
			{ row: 0, col: 4, expected: '2023-10-20 15:30:00' },
			{ row: 1, col: 4, expected: '2024-01-01 08:00:00' },
			{ row: 2, col: 4, expected: '' },

			// Timestamp with timezone type
			{ row: 0, col: 5, expected: '2023-10-20 15:30:00+00' },
			{ row: 1, col: 5, expected: '2024-01-01 08:00:00-05' },
			{ row: 2, col: 5, expected: '' },

			// Time type
			{ row: 0, col: 6, expected: '13:30:00' },
			{ row: 1, col: 6, expected: '07:12:34.567' },
			{ row: 2, col: 6, expected: '' }
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

		await testRowRange(1, 2, 'int_col,str_col,float_col\n2,b,2.2\n3,c,3.3')

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

		await testColRange(0, 1, 'int_col,str_col\n1,a\n2,b\n3,c\n4,d\n5,e');

		// Test RowIndices selection
		const testRowIndices = async (indices: number[], expected: string) => {
			await testSelection(TableSelectionKind.RowIndices, { indices }, expected);
		};
		await testRowIndices([1, 3], 'int_col,str_col,float_col\n2,b,2.2\n4,d,4.4');

		// Test ColumnIndices selection
		const testColumnIndices = async (indices: number[], expected: string) => {
			await testSelection(TableSelectionKind.ColumnIndices, { indices }, expected);
		};
		await testColumnIndices([0, 2], 'int_col,float_col\n1,1.1\n2,2.2\n3,3.3\n4,4.4\n5,5.5');

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
		)

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

		const uri = `duckdb://${tableName}`;

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
				uri,
				params: { filters: [] }
			});

			// Check that reset back to original state
			let currentState = await getState(uri);
			assert.deepStrictEqual(currentState, origState);

			await dxExec({
				method: DataExplorerBackendRequest.SetRowFilters,
				uri,
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

	test('set_sort_columns works correctly', async () => {
		const tableName = makeTempTableName();

		// DuckDB sorts are not stable, so we introduce a row_index auxiliary field to make stable
		const selectQuery = `SELECT *, ROW_NUMBER() OVER() AS row_index
		FROM parquet_scan('${flightParquet}') LIMIT 1000`;

		await createTableAsSelect(tableName, selectQuery);
		const uri = `duckdb://${tableName}`;

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
				uri,
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
				uri,
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
});
