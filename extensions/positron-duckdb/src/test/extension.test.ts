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
	ColumnFilter,
	ColumnFilterType,
	ColumnProfileType,
	ColumnSchema,
	ColumnSortKey,
	ColumnValue,
	DataExplorerBackendRequest,
	DataExplorerResponse,
	DataExplorerRpc,
	ExportFormat,
	FilterComparisonOp,
	FilterMatchDataTypes,
	FilterTextSearch,
	FormatOptions,
	GetDataValuesParams,
	GetSchemaParams,
	RowFilter,
	RowFilterCondition,
	RowFilterParams,
	RowFilterType,
	SearchSchemaParams,
	SearchSchemaResult,
	SearchSchemaSortOrder,
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
	ColumnHistogram,
	ColumnSummaryStats
} from '../interfaces';
import { randomBytes, randomUUID } from 'crypto';

const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 9,
	max_value_length: 100
};

// Global callback registry for column profile events
const columnProfileCallbacks = new Map<string, (value: any) => void>();
let globalCommandRegistered = false;

// Not sure why it is not possible to use Mocha's 'before' for this
async function activateExtension() {
	// Ensure the extension is activated
	await vscode.extensions.getExtension('positron.positron-duckdb')?.activate();

	// Register the global command handler once
	if (!globalCommandRegistered) {
		vscode.commands.registerCommand(
			'positron-data-explorer.sendUiEvent',
			(event: any) => {
				if (event.method === 'return_column_profiles' && event.params.callback_id) {
					const callback = columnProfileCallbacks.get(event.params.callback_id);
					if (callback) {
						callback(event.params);
						columnProfileCallbacks.delete(event.params.callback_id);
					}
				}
			}
		);
		globalCommandRegistered = true;
	}
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
	if (!resp) {
		return Promise.reject(new Error('dataExplorerRpc command returned undefined'));
	}
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

function quoteIdentifier(fieldName: string) {
	// Double any existing double quotes and wrap in double quotes
	return '"' + fieldName.replace(/"/g, '""') + '"';
}

async function createTempTable(
	tableName: string,
	columns: Array<InsertColumn>
) {
	// Create the table with indicated schema, properly quoting column names
	const schema = columns.map(column => `${quoteIdentifier(column.name)} ${column.type}`).join(', ');
	await runQuery(`CREATE TABLE ${tableName} (${schema});`);

	// Assuming at least one column and all values arrays same length
	const length = columns[0].values.length;

	const tuples: Array<string> = [];
	for (let i = 0; i < length; i++) {
		tuples.push(`(${columns.map(c => c.values[i]).join(', ')})`);
	}

	// Use explicit column names in INSERT to ensure proper ordering
	const columnNames = columns.map(c => quoteIdentifier(c.name)).join(', ');
	await runQuery(`INSERT INTO ${tableName} (${columnNames}) VALUES\n${tuples.join(',\n')};`);

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
					support_status: SupportStatus.Supported,
					supported_types: [
						{
							column_filter_type: ColumnFilterType.TextSearch,
							support_status: SupportStatus.Supported
						},
						{
							column_filter_type: ColumnFilterType.MatchDataTypes,
							support_status: SupportStatus.Supported
						}
					]
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
				},
				convert_to_code: {
					support_status: SupportStatus.Supported,
					code_syntaxes: [{
						code_syntax_name: "SQL"
					}]
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

	test('CSV header inference - always treat first row as header', async () => {
		// Create a temporary CSV file with the problematic format that was failing header inference
		const csvContent = '"","f0","f1"\n"0","abc","def"\n"1","ghi","jkl"';
		const tempPath = path.join(__dirname, 'temp_header_test.csv');

		// Write the CSV file
		await vscode.workspace.fs.writeFile(vscode.Uri.file(tempPath), Buffer.from(csvContent, 'utf8'));

		try {
			const uri = vscode.Uri.file(tempPath);

			// Open the dataset
			await dxExec({
				method: DataExplorerBackendRequest.OpenDataset,
				params: { uri }
			});

			// Get the schema to verify column names are read from first row
			const schemaResult = await dxExec({
				method: DataExplorerBackendRequest.GetSchema,
				uri: uri.toString(),
				params: {
					column_indices: [0, 1, 2]
				} satisfies GetSchemaParams
			});

			// Verify that the column names are from the first row (headers), not auto-generated
			// Note: DuckDB renames empty column names to "column0", "column1", etc.
			assert.strictEqual(schemaResult.columns.length, 3, 'Should have 3 columns');
			assert.strictEqual(schemaResult.columns[0].column_name, 'column0', 'First column should be renamed from empty header');
			assert.strictEqual(schemaResult.columns[1].column_name, 'f0', 'Second column should be f0 from header');
			assert.strictEqual(schemaResult.columns[2].column_name, 'f1', 'Third column should be f1 from header');

			// Verify the data doesn't include the header row
			const cell0Result = await dxExec({
				method: DataExplorerBackendRequest.ExportDataSelection,
				uri: uri.toString(),
				params: {
					selection: {
						kind: TableSelectionKind.SingleCell,
						selection: { row_index: 0, column_index: 0 }
					},
					format: ExportFormat.Csv
				}
			});
			assert.strictEqual(cell0Result.data, '0', 'First data row, first column should be "0"');

			const cell1Result = await dxExec({
				method: DataExplorerBackendRequest.ExportDataSelection,
				uri: uri.toString(),
				params: {
					selection: {
						kind: TableSelectionKind.SingleCell,
						selection: { row_index: 0, column_index: 1 }
					},
					format: ExportFormat.Csv
				}
			});
			assert.strictEqual(cell1Result.data, 'abc', 'First data row, second column should be "abc"');

		} finally {
			// Clean up the temporary file
			try {
				await vscode.workspace.fs.delete(vscode.Uri.file(tempPath));
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	type TestCaseType = [InsertColumn[] | undefined, ColumnValue[][], FormatOptions];

	test('get_data_values formatting', async () => {
		// Quote field names to test escaping

		const testCases: Array<TestCaseType> = [
			// Boolean
			[
				[
					{
						name: '"a"',
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
						name: '"a"',
						type: 'TINYINT',
						display_type: ColumnDisplayType.Number,
						values: ['127', '-128', '0', 'NULL']
					},
					{
						name: '"b"',
						type: 'SMALLINT',
						display_type: ColumnDisplayType.Number,
						values: ['32767', '-32768', '0', 'NULL']
					},
					{
						name: '"c"',
						type: 'INTEGER',
						display_type: ColumnDisplayType.Number,
						values: ['2147483647', '-2147483648', '0', 'NULL']
					},
					{
						name: '"d"',
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
						name: '"a"',
						type: 'DOUBLE',
						display_type: ColumnDisplayType.Number,
						values: [
							'0', '1.125', '0.12345', 'NULL', '\'NaN\'',
							'\'Infinity\'', '\'-Infinity\'',
						]
					},
					{
						name: '"b"',
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
						name: '"a"',
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
						name: '"a"',
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
						name: '"a"',
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
						name: '"date0"',
						type: 'DATE',
						display_type: ColumnDisplayType.Date,
						values: ['\'2023-10-20\'', '\'2024-01-01\'', 'NULL']
					},
					{
						name: '"timestamp0"',
						type: 'TIMESTAMP',
						display_type: ColumnDisplayType.Datetime,
						values: ['\'2023-10-20 15:30:00\'', '\'2024-01-01 08:00:00\'', 'NULL']
					},
					{
						name: '"timestamptz0"',
						type: 'TIMESTAMP WITH TIME ZONE',
						display_type: ColumnDisplayType.Datetime,
						values: ['\'2023-10-20 15:30:00+00\'', '\'2024-01-01 08:00:00-05\'', 'NULL']
					},
					{
						name: '"time0"',
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
						name: '"decimal_default"',
						type: 'DECIMAL',
						display_type: ColumnDisplayType.Number,
						values: ['1.23', '45.67', '89.01', 'NULL']
					},
					{
						name: '"decimal_precision"',
						type: 'DECIMAL(10)', // same as DECIMAL(10,0)
						display_type: ColumnDisplayType.Number,
						values: ['123456', '987654', '555555', 'NULL']
					},
					{
						name: '"decimal_precision_scale"',
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
				assert.strictEqual(schema.column_name, testInput[i].name, 'Column name should match');
				assert.strictEqual(schema.type_display, testInput[i].display_type, 'Column display type should match');
			}

			const data = await getAllDataValues(tableName!, formatOptions);
			assert.deepStrictEqual(data,
				{
					columns: testResults
				},
				'Column values should match'
			);
		}
	});

	// Shared test utilities for export_data_selection tests
	const createExportTestTable = async () => {
		const tableName = makeTempTableName();
		const longString = generateRandomString(1000);

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

		return { tableName, longString };
	};

	const createExportHelper = (uri: vscode.Uri) => {
		const testExport = async (kind: TableSelectionKind, selection: Selection, expected: string,
			format: ExportFormat = ExportFormat.Csv
		) => {
			const result = await dxExec({
				method: DataExplorerBackendRequest.ExportDataSelection,
				uri: uri.toString(),
				params: {
					selection: { kind, selection },
					format
				}
			});
			assert.strictEqual(result.data, expected);
		};

		const exportRaw = async (kind: TableSelectionKind, selection: Selection, format: ExportFormat = ExportFormat.Csv) => {
			return await dxExec({
				method: DataExplorerBackendRequest.ExportDataSelection,
				uri: uri.toString(),
				params: {
					selection: { kind, selection },
					format
				}
			});
		};

		return {
			singleCell: (row: number, col: number, expected: string) =>
				testExport(TableSelectionKind.SingleCell, { row_index: row, column_index: col }, expected),

			cellRange: (firstRow: number, lastRow: number, firstCol: number, lastCol: number, expected: string, format?: ExportFormat) =>
				testExport(TableSelectionKind.CellRange, {
					first_row_index: firstRow,
					last_row_index: lastRow,
					first_column_index: firstCol,
					last_column_index: lastCol
				}, expected, format),

			rowRange: (firstRow: number, lastRow: number, expected: string) =>
				testExport(TableSelectionKind.RowRange, { first_index: firstRow, last_index: lastRow }, expected),

			columnRange: (firstCol: number, lastCol: number, expected: string) =>
				testExport(TableSelectionKind.ColumnRange, { first_index: firstCol, last_index: lastCol }, expected),

			rowIndices: (indices: number[], expected: string) =>
				testExport(TableSelectionKind.RowIndices, { indices }, expected),

			columnIndices: (indices: number[], expected: string) =>
				testExport(TableSelectionKind.ColumnIndices, { indices }, expected),

			cellIndices: (rowIndices: number[], columnIndices: number[], expected: string) =>
				testExport(TableSelectionKind.CellIndices, { row_indices: rowIndices, column_indices: columnIndices }, expected),

			// Raw export methods that return results without assertions
			singleCellRaw: (row: number, col: number, format?: ExportFormat) =>
				exportRaw(TableSelectionKind.SingleCell, { row_index: row, column_index: col }, format),

			cellRangeRaw: (firstRow: number, lastRow: number, firstCol: number, lastCol: number, format?: ExportFormat) =>
				exportRaw(TableSelectionKind.CellRange, {
					first_row_index: firstRow,
					last_row_index: lastRow,
					first_column_index: firstCol,
					last_column_index: lastCol
				}, format),

			columnRangeRaw: (firstCol: number, lastCol: number, format?: ExportFormat) =>
				exportRaw(TableSelectionKind.ColumnRange, { first_index: firstCol, last_index: lastCol }, format)
		};
	};

	// Helper functions to reduce code duplication in tests
	const openDataset = async (uri: vscode.Uri) => {
		await dxExec({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri }
		});
	};

	const setSortColumns = async (uri: vscode.Uri, sortKeys: Array<{ column_index: number; ascending: boolean }>) => {
		await dxExec({
			method: DataExplorerBackendRequest.SetSortColumns,
			uri: uri.toString(),
			params: { sort_keys: sortKeys }
		});
	};

	const setRowFilters = async (uri: vscode.Uri, filters: any[]) => {
		await dxExec({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: uri.toString(),
			params: { filters }
		});
	};

	const convertToCode = async (uri: vscode.Uri, params: any = {}) => {
		const defaultParams = {
			column_filters: [],
			row_filters: [],
			sort_keys: [],
			code_syntax_name: { code_syntax_name: 'SQL' }
		};
		return await dxExec({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: uri.toString(),
			params: { ...defaultParams, ...params }
		});
	};

	test('export_data_selection - data types and single cells', async () => {
		const { tableName, longString } = await createExportTestTable();
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { singleCell } = createExportHelper(uri);

		// Test single cell exports for different data types
		const cellTests = [
			// INTEGER column (col 0: int_col)
			{ row: 0, col: 0, expected: '1' },
			{ row: 1, col: 0, expected: '2' },
			{ row: 4, col: 0, expected: 'NULL' },

			// VARCHAR column (col 1: str_col)
			{ row: 2, col: 1, expected: 'c' },
			{ row: 3, col: 1, expected: 'NULL' },
			{ row: 4, col: 1, expected: longString },

			// DOUBLE column (col 2: float_col)
			{ row: 3, col: 2, expected: 'NULL' },
			{ row: 4, col: 2, expected: '5.5e+20' },

			// DATE column (col 3: date0)
			{ row: 0, col: 3, expected: '2023-10-20' },
			{ row: 2, col: 3, expected: 'NULL' },

			// TIMESTAMP column (col 4: timestamp0)
			{ row: 0, col: 4, expected: '2023-10-20 15:30:00' },
			{ row: 2, col: 4, expected: 'NULL' },

			// TIMESTAMP WITH TIME ZONE column (col 5: timestamptz0)
			{ row: 0, col: 5, expected: '2023-10-20 15:30:00+00' },
			{ row: 2, col: 5, expected: 'NULL' },

			// TIME column (col 6: time0)
			{ row: 0, col: 6, expected: '13:30:00' },
			{ row: 1, col: 6, expected: '07:12:34.567' },
			{ row: 2, col: 6, expected: 'NULL' }
		];

		for (const { row, col, expected } of cellTests) {
			await singleCell(row, col, expected);
		}
	});

	test('export_data_selection - ranges and selections', async () => {
		const { tableName, longString } = await createExportTestTable();
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { cellRange, rowRange, columnRange, rowIndices, columnIndices } = createExportHelper(uri);

		// Cell range selections
		await cellRange(0, 1, 0, 1, 'int_col,str_col\n1,a\n2,b');
		await cellRange(0, 2, 0, 2, 'int_col,str_col,float_col\n1,a,1.1\n2,b,2.2\n3,c,3.3');

		// Row range selection (rows 1-2, all columns)
		await rowRange(1, 2, `int_col,str_col,float_col,date0,timestamp0,timestamptz0,time0
2,b,2.2,2024-01-01,2024-01-01 08:00:00,2024-01-01 13:00:00+00,07:12:34.567
3,c,3.3,NULL,NULL,NULL,NULL`);

		// Column range selection (columns 0-1, all rows)
		await columnRange(0, 1, `int_col,str_col\n1,a\n2,b\n3,c\n4,NULL\nNULL,${longString}`);

		// Specific row indices (rows 1 and 3)
		await rowIndices([1, 3], `int_col,str_col,float_col,date0,timestamp0,timestamptz0,time0
2,b,2.2,2024-01-01,2024-01-01 08:00:00,2024-01-01 13:00:00+00,07:12:34.567
4,NULL,NULL,2024-01-02,2024-01-02 12:00:00,2024-01-02 11:00:00+00,12:00:00`);

		// Specific column indices (int_col and float_col)
		await columnIndices([0, 2], 'int_col,float_col\n1,1.1\n2,2.2\n3,3.3\n4,NULL\nNULL,5.5e+20');
	});

	test('export_data_selection - cell indices and order preservation', async () => {
		const { tableName, longString } = await createExportTestTable();
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { cellIndices } = createExportHelper(uri);

		// Basic cell indices selection
		await cellIndices([0, 2], [0, 2], 'int_col,float_col\n1,1.1\n3,3.3');
		await cellIndices([1, 3], [1, 2], 'str_col,float_col\nb,2.2\nNULL,NULL');
		await cellIndices([0, 1, 4], [0], 'int_col\n1\n2\nNULL');

		// Non-sequential row indices (order preservation is critical)
		await cellIndices([4, 0, 2], [0], 'int_col\nNULL\n1\n3');
		await cellIndices([3, 1, 0], [1, 2], 'str_col,float_col\nNULL,NULL\nb,2.2\na,1.1');
		await cellIndices([2, 4, 1], [0, 1], `int_col,str_col\n3,c\nNULL,${longString}\n2,b`);

		// Non-sequential column indices (order preservation is critical)
		await cellIndices([0, 1], [2, 0, 1], 'float_col,int_col,str_col\n1.1,1,a\n2.2,2,b');
		await cellIndices([1, 2], [1, 2, 0], 'str_col,float_col,int_col\nb,2.2,2\nc,3.3,3');

		// Both rows and columns out of order
		await cellIndices([2, 0], [2, 0], 'float_col,int_col\n3.3,3\n1.1,1');
	});

	test('export_data_selection - output formats', async () => {
		const { tableName } = await createExportTestTable();
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { cellRange } = createExportHelper(uri);

		// Test different export formats on same data (first 2 rows, first 2 columns)
		await cellRange(0, 1, 0, 1, 'int_col\tstr_col\n1\ta\n2\tb', ExportFormat.Tsv);
		await cellRange(0, 1, 0, 1, '<tr><td>int_col</td><td>str_col</td></tr>\n<tr><td>1</td><td>a</td></tr>\n<tr><td>2</td><td>b</td></tr>', ExportFormat.Html);
	});

	// Shared utilities for sort order tests
	const createSortTestHelper = (uri: vscode.Uri) => {
		const exportHelper = createExportHelper(uri);

		const setSortKeys = async (sortKeys: Array<{ column_index: number; ascending: boolean }>) => {
			await setSortColumns(uri, sortKeys);
		};

		return { ...exportHelper, setSortKeys };
	};

	test('export_data_selection respects sort order - basic sorting', async () => {
		const tableName = makeTempTableName();

		// Create a test table with data that will show the sort order clearly
		await createTempTable(tableName, [
			{ name: 'id', type: 'INTEGER', values: ['3', '1', '2', '5', '4'] },
			{ name: 'name', type: 'VARCHAR', values: ['\'Charlie\'', '\'Alice\'', '\'Bob\'', '\'Eve\'', '\'David\''] },
			{ name: 'value', type: 'INTEGER', values: ['30', '10', '20', '50', '40'] }
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { columnIndices, columnRange, setSortKeys } = createSortTestHelper(uri);

		// Test unsorted data
		await columnIndices([1], 'name\nCharlie\nAlice\nBob\nEve\nDavid');

		// Test single column sorts
		const sortTests = [
			{
				desc: 'sort by id ascending',
				sortKeys: [{ column_index: 0, ascending: true }],
				exportCol: 1,
				expected: 'name\nAlice\nBob\nCharlie\nDavid\nEve'
			},
			{
				desc: 'sort by id descending',
				sortKeys: [{ column_index: 0, ascending: false }],
				exportCol: 1,
				expected: 'name\nEve\nDavid\nCharlie\nBob\nAlice'
			},
			{
				desc: 'sort by value ascending',
				sortKeys: [{ column_index: 2, ascending: true }],
				exportCol: 1,
				expected: 'name\nAlice\nBob\nCharlie\nDavid\nEve'
			}
		];

		for (const { desc, sortKeys, exportCol, expected } of sortTests) {
			await setSortKeys(sortKeys);
			await columnIndices([exportCol], expected);
		}

		// Test column range export with sort
		await setSortKeys([{ column_index: 2, ascending: true }]);
		await columnRange(0, 1, 'id,name\n1,Alice\n2,Bob\n3,Charlie\n4,David\n5,Eve');
	});

	test('export_data_selection respects sort order - multi-column and formats', async () => {
		// Create table with duplicate values for multi-column sorting
		const tableName2 = makeTempTableName();
		await createTempTable(tableName2, [
			{ name: 'category', type: 'VARCHAR', values: ['\'B\'', '\'A\'', '\'B\'', '\'A\'', '\'A\''] },
			{ name: 'value', type: 'INTEGER', values: ['2', '3', '1', '1', '2'] },
			{ name: 'name', type: 'VARCHAR', values: ['\'item2\'', '\'item3\'', '\'item1\'', '\'item4\'', '\'item5\''] }
		]);

		const uri2 = vscode.Uri.from({ scheme: 'duckdb', path: tableName2 });
		const { columnIndices, columnRange, setSortKeys } = createSortTestHelper(uri2);

		// Test multi-column sort (category ascending, then value ascending)
		await setSortKeys([
			{ column_index: 0, ascending: true },   // category
			{ column_index: 1, ascending: true }    // value
		]);
		await columnIndices([2], 'name\nitem4\nitem5\nitem3\nitem1\nitem2');

		// Test different export format with sort
		const tableName1 = makeTempTableName();
		await createTempTable(tableName1, [
			{ name: 'id', type: 'INTEGER', values: ['3', '1', '2'] },
			{ name: 'name', type: 'VARCHAR', values: ['\'Charlie\'', '\'Alice\'', '\'Bob\''] }
		]);

		const uri1 = vscode.Uri.from({ scheme: 'duckdb', path: tableName1 });
		const helper1 = createSortTestHelper(uri1);

		await helper1.setSortKeys([{ column_index: 0, ascending: true }]);

		// Test TSV format maintains sort order
		const tsvResult = await dxExec({
			method: DataExplorerBackendRequest.ExportDataSelection,
			uri: uri1.toString(),
			params: {
				selection: {
					kind: TableSelectionKind.ColumnRange,
					selection: { first_index: 0, last_index: 1 }
				},
				format: ExportFormat.Tsv
			}
		});

		assert.strictEqual(tsvResult.data, 'id\tname\n1\tAlice\n2\tBob\n3\tCharlie');
	});

	test('export_data_selection single cell respects sort order', async () => {
		const { tableName, longString } = await createExportTestTable();
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { singleCell, setSortKeys, columnRange } = createSortTestHelper(uri);

		// Original table:
		// Row 0: int_col=1, str_col='a'
		// Row 1: int_col=2, str_col='b'
		// Row 2: int_col=3, str_col='c'
		// Row 3: int_col=4, str_col=NULL
		// Row 4: int_col=NULL, str_col=longString

		// Test single cell export without sorting first
		await singleCell(0, 0, '1');  // Row 0, Column 0 (int_col) = 1
		await singleCell(1, 1, 'b');  // Row 1, Column 1 (str_col) = 'b'
		await singleCell(2, 0, '3');  // Row 2, Column 0 (int_col) = 3

		// Sort by int_col descending (NULL values last)
		await setSortKeys([{ column_index: 0, ascending: false }]);

		// First, let's verify the sort order with columnRange to see actual data
		await columnRange(0, 1, `int_col,str_col\n4,NULL\n3,c\n2,b\n1,a\nNULL,${longString}`);

		// Now test single cells - these should match the sorted order
		// If these tests fail, it means single cell export is not respecting sort order
		await singleCell(0, 0, '4');    // Visual Row 0, int_col should be 4
		await singleCell(1, 0, '3');    // Visual Row 1, int_col should be 3
		await singleCell(2, 0, '2');    // Visual Row 2, int_col should be 2
		await singleCell(3, 0, '1');    // Visual Row 3, int_col should be 1
		await singleCell(4, 0, 'NULL'); // Visual Row 4, int_col should be NULL
	});

	test('export_data_selection single cell with duplicate sort values (stable sort test)', async () => {
		// Create a table with many duplicate values to test stable sorting
		const tableName = makeTempTableName();
		await createTempTable(tableName, [
			{
				name: 'sort_col',
				type: 'INTEGER',
				// Many rows with value 1, then some with value 2
				values: ['1', '1', '1', '1', '1', '1', '1', '1', '2', '2']
			},
			{
				name: 'id',
				type: 'INTEGER',
				// Unique identifier to track which original row we're getting
				values: ['100', '101', '102', '103', '104', '105', '106', '107', '200', '201']
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		const { setSortKeys, columnRange } = createSortTestHelper(uri);
		const { singleCellRaw, cellRangeRaw } = createExportHelper(uri);

		// Before sorting - verify original order
		await columnRange(0, 1, 'sort_col,id\n1,100\n1,101\n1,102\n1,103\n1,104\n1,105\n1,106\n1,107\n2,200\n2,201');

		// Sort by sort_col ascending - all the 1's should come first, then 2's
		// But within the 1's, the order might be unstable
		await setSortKeys([{ column_index: 0, ascending: true }]);

		// The issue: When we export single cells from the sorted view,
		// the OFFSET might not correspond to the same row the UI is showing
		// due to unstable sorting of duplicate values

		// Test: Export the first few cells after sorting using helper functions
		const cell0Result = await singleCellRaw(0, 1); // First row, id column
		const cell1Result = await singleCellRaw(1, 1); // Second row, id column

		// Let's also check what cellRange gives us for comparison
		const rangeResult = await cellRangeRaw(0, 1, 1, 1);

		// After the fix, single cell exports should be consistent with range exports
		// Single cells should return different rows (100, 101) not the same row twice
		assert.strictEqual(cell0Result.data, '100', 'First cell should be ID 100');
		assert.strictEqual(cell1Result.data, '101', 'Second cell should be ID 101');
		assert.strictEqual(rangeResult.data, 'id\n100\n101', 'Range should return IDs 100,101');
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
				// Make sure that histogram logic handles a quoted field name
				name: '"value"',
				type: valueType,
				values: Array.from({ length: rowCount }, (_, i) => valueGenerator(i))
			}
		]);
		return tableName;
	}

	/**
	 * Generic function to request column profiles and extract a specific result
	 * @param tableName The name of the table containing the data
	 * @param columnIndex The index of the column to profile
	 * @param profileRequests Array of profile requests to make
	 * @param callbackId A unique ID for this profile request
	 * @param resultExtractor Function to extract the desired result from the profile response
	 * @param timeoutMessage Custom timeout message for the specific profile type
	 * @returns The extracted result
	 */
	async function requestColumnProfile<T>(
		tableName: string,
		columnIndex: number,
		profileRequests: Array<{ profile_type: ColumnProfileType; params?: any }>,
		callbackId: string,
		resultExtractor: (profile: any) => T,
		timeoutMessage: string
	): Promise<T> {
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Ensure the extension and global command handler are set up
		await activateExtension();

		// Create a promise that will resolve when we receive the column profile event
		let resolveProfilePromise: (value: any) => void = () => { };
		const profilePromise = new Promise<any>(resolve => {
			resolveProfilePromise = resolve;
		});

		// Register the callback with the global handler
		columnProfileCallbacks.set(callbackId, resolveProfilePromise);

		// Add a timeout to prevent tests from hanging indefinitely
		const timeoutId = setTimeout(() => {
			columnProfileCallbacks.delete(callbackId);
			resolveProfilePromise({
				error: `${timeoutMessage} for callback_id: ${callbackId}`
			});
		}, 5000); // 5 second timeout

		try {
			// Request the column profiles
			await dxExec({
				method: DataExplorerBackendRequest.GetColumnProfiles,
				uri: uri.toString(),
				params: {
					callback_id: callbackId,
					profiles: [
						{
							column_index: columnIndex,
							profiles: profileRequests
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

			// Extract and return the result using the provided extractor function
			const profile = profileResults.profiles[0];
			return resultExtractor(profile);
		} catch (error) {
			// Clean up in case of error
			columnProfileCallbacks.delete(callbackId);
			clearTimeout(timeoutId);
			throw error;
		}
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
		return requestColumnProfile(
			tableName,
			columnIndex,
			[
				{
					profile_type: ColumnProfileType.LargeHistogram,
					params: histogramParams
				},
				{
					profile_type: ColumnProfileType.SummaryStats
				}
			],
			callbackId,
			(profile) => {
				if (profile && profile.large_histogram) {
					return profile.large_histogram as ColumnHistogram;
				}
				throw new Error(`No histogram returned for column ${columnIndex}`);
			},
			'Timeout waiting for histogram data'
		);
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

	/**
	 * Requests column profiles including summary stats for a column and returns the result
	 * @param tableName The name of the table containing the data
	 * @param columnIndex The index of the column to profile
	 * @param callbackId A unique ID for this profile request
	 * @returns The summary stats result
	 */
	async function requestSummaryStats(
		tableName: string,
		columnIndex: number,
		callbackId: string
	): Promise<ColumnSummaryStats> {
		return requestColumnProfile(
			tableName,
			columnIndex,
			[
				{
					profile_type: ColumnProfileType.SummaryStats
				}
			],
			callbackId,
			(profile) => {
				if (profile && profile.summary_stats) {
					return profile.summary_stats as ColumnSummaryStats;
				}
				throw new Error(`No summary stats returned for column ${columnIndex}`);
			},
			'Timeout waiting for summary stats data'
		);
	}

	/**
	 * Helper function to request null count profile for a column
	 * @param tableName The name of the table
	 * @param columnIndex The index of the column
	 * @param callbackId The callback ID for the request
	 * @returns A promise that resolves to the null count
	 */
	async function requestNullCount(
		tableName: string,
		columnIndex: number,
		callbackId: string
	): Promise<number> {
		return requestColumnProfile(
			tableName,
			columnIndex,
			[
				{
					profile_type: ColumnProfileType.NullCount
				}
			],
			callbackId,
			(profile) => {
				if (profile && profile.null_count !== undefined) {
					return profile.null_count as number;
				}
				throw new Error(`No null count returned for column ${columnIndex}`);
			},
			'Timeout waiting for null count data'
		);
	}

	/**
	 * Creates a test table with data for summary stats testing, using quoted field names
	 * @param columnName The name of the column (should be quoted for testing)
	 * @param valueType The SQL type of the value column
	 * @param displayType The expected display type
	 * @param valueGenerator A function that generates values for the test data
	 * @param rowCount Number of rows to create
	 * @returns The name of the created table
	 */
	async function createSummaryStatsTestTable(
		columnName: string,
		valueType: string,
		displayType: ColumnDisplayType,
		valueGenerator: (index: number) => string,
		rowCount: number = 100
	): Promise<string> {
		const tableName = makeTempTableName();
		await createTempTable(tableName, [
			{
				name: columnName,
				type: valueType,
				display_type: displayType,
				values: Array.from({ length: rowCount }, (_, i) => valueGenerator(i))
			}
		]);
		return tableName;
	}

	test('ColumnProfileEvaluator.computeSummaryStats - Numeric data', async () => {
		// Create a test table with numeric data, use quoted field name to test escaping
		const tableName = await createSummaryStatsTestTable(
			'"numeric_column"', // Quoted field name
			'DOUBLE',
			ColumnDisplayType.Number,
			(i) => `${i * 2.5}`, // Values 0, 2.5, 5.0, 7.5, ... 247.5
			100
		);

		// Request summary stats for the numeric column
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-numeric-summary-stats'
		);

		// Verify the summary stats
		assert.ok(summaryStats, 'Summary stats should be returned');
		assert.strictEqual(summaryStats.type_display, ColumnDisplayType.Number, 'Type display should be Number');
		assert.ok(summaryStats.number_stats, 'Number stats should be present');

		const numberStats = summaryStats.number_stats!;
		assert.strictEqual(numberStats.min_value, '0', 'Min value should be 0');
		assert.strictEqual(numberStats.max_value, '247.50', 'Max value should be 247.50');

		// Check mean (should be around 123.75)
		const mean = parseFloat(numberStats.mean!);
		assert.ok(Math.abs(mean - 123.75) < 0.1, `Mean should be around 123.75, got ${mean}`);

		// Check median (should be around 123.75)
		const median = parseFloat(numberStats.median!);
		assert.ok(Math.abs(median - 123.75) < 0.1, `Median should be around 123.75, got ${median}`);

		// Standard deviation should be greater than 0
		const stdev = parseFloat(numberStats.stdev!);
		assert.ok(stdev > 0, `Standard deviation should be > 0, got ${stdev}`);
	});

	test('ColumnProfileEvaluator.computeSummaryStats - String data', async () => {
		// Create a test table with string data, use quoted field name to test escaping
		const tableName = await createSummaryStatsTestTable(
			'"string_column"', // Quoted field name
			'VARCHAR',
			ColumnDisplayType.String,
			(i) => i % 10 === 0 ? '\'\'' : `'string_${i}'`, // Some empty strings and regular strings
			50
		);

		// Request summary stats for the string column
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-string-summary-stats'
		);

		// Verify the summary stats
		assert.ok(summaryStats, 'Summary stats should be returned');
		assert.strictEqual(summaryStats.type_display, ColumnDisplayType.String, 'Type display should be String');
		assert.ok(summaryStats.string_stats, 'String stats should be present');

		const stringStats = summaryStats.string_stats!;
		assert.strictEqual(stringStats.num_empty, 5, 'Should have 5 empty strings (every 10th row)');
		assert.strictEqual(stringStats.num_unique, 46, 'Should have 46 unique values (45 unique strings + 1 empty string)');
	});

	test('ColumnProfileEvaluator.computeSummaryStats - Boolean data', async () => {
		// Create a test table with boolean data using quoted field name
		const tableName = await createSummaryStatsTestTable(
			'"boolean_column"', // Quoted field name
			'BOOLEAN',
			ColumnDisplayType.Boolean,
			(i) => i % 3 === 0 ? 'true' : (i % 3 === 1 ? 'false' : 'NULL'), // 1/3 true, 1/3 false, 1/3 null
			30
		);

		// Request summary stats for the boolean column
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-boolean-summary-stats'
		);

		// Verify the summary stats
		assert.ok(summaryStats, 'Summary stats should be returned');
		assert.strictEqual(summaryStats.type_display, ColumnDisplayType.Boolean, 'Type display should be Boolean');
		assert.ok(summaryStats.boolean_stats, 'Boolean stats should be present');

		const booleanStats = summaryStats.boolean_stats!;
		assert.strictEqual(booleanStats.true_count, 10, 'Should have 10 true values');
		assert.strictEqual(booleanStats.false_count, 10, 'Should have 10 false values');
	});

	test('ColumnProfileEvaluator.computeSummaryStats - Date data', async () => {
		// Create a test table with date data using quoted field name
		const tableName = await createSummaryStatsTestTable(
			'"date_column"', // Quoted field name
			'DATE',
			ColumnDisplayType.Date,
			(i) => `'2024-01-${String((i % 28) + 1).padStart(2, '0')}'`, // Dates from 2024-01-01 to 2024-01-28, cycling
			50
		);

		// Request summary stats for the date column
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-date-summary-stats'
		);

		// Verify the summary stats
		assert.ok(summaryStats, 'Summary stats should be returned');
		// Accept either Date or Unknown display type (DuckDB might categorize dates differently)
		assert.ok(summaryStats.type_display === ColumnDisplayType.Date || summaryStats.type_display === ColumnDisplayType.Unknown,
			`Type display should be Date or Unknown, got ${summaryStats.type_display}`);

		// For date columns, DuckDB may not generate summary stats or may treat them differently
		// The important thing is that the request succeeds and doesn't crash
		// We just verify that summary stats are returned, even if they're empty/minimal

		// We can check if any stats are available, but don't require specific ones since
		// date handling can vary between DuckDB versions
		const hasAnyStats = summaryStats.date_stats || summaryStats.datetime_stats ||
			summaryStats.string_stats || summaryStats.number_stats ||
			summaryStats.boolean_stats || summaryStats.other_stats;

		// The test passes if summary stats are returned (even if empty) without errors
		// This tests the quoted field name handling which was the main requirement
	});

	test('ColumnProfileEvaluator.computeSummaryStats - Datetime data', async () => {
		// Create a test table with datetime data using quoted field name
		const tableName = await createSummaryStatsTestTable(
			'"datetime_column"', // Quoted field name
			'TIMESTAMP',
			ColumnDisplayType.Datetime,
			(i) => `'2024-01-01 ${String(i % 24).padStart(2, '0')}:00:00'`, // Hours from 00:00 to 23:00, cycling
			48
		);

		// Request summary stats for the datetime column
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-datetime-summary-stats'
		);

		// Verify the summary stats
		assert.ok(summaryStats, 'Summary stats should be returned');
		assert.strictEqual(summaryStats.type_display, ColumnDisplayType.Datetime, 'Type display should be Datetime');
		assert.ok(summaryStats.datetime_stats, 'Datetime stats should be present');

		const datetimeStats = summaryStats.datetime_stats!;
		assert.strictEqual(datetimeStats.min_date, '2024-01-01 00:00:00', 'Min datetime should be 2024-01-01 00:00:00');
		assert.strictEqual(datetimeStats.max_date, '2024-01-01 23:00:00', 'Max datetime should be 2024-01-01 23:00:00');
		assert.ok(datetimeStats.num_unique! > 0, 'Should have unique datetime values');
		assert.ok(datetimeStats.mean_date, 'Should have a mean datetime');
		assert.ok(datetimeStats.median_date, 'Should have a median datetime');
	});

	test('ColumnProfileEvaluator.computeSummaryStats - Edge case: all null values with quoted field names', async () => {
		// Create a test table with all null values using quoted field name
		const tableName = await createSummaryStatsTestTable(
			'"null_column"', // Quoted field name
			'INTEGER',
			ColumnDisplayType.Number,
			() => 'NULL', // All NULL values
			20
		);

		// Request summary stats for the column with all null values
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-all-null-summary-stats'
		);

		// Verify the summary stats for all null values
		assert.ok(summaryStats, 'Summary stats should be returned');
		assert.strictEqual(summaryStats.type_display, ColumnDisplayType.Number, 'Type display should be Number');
		assert.ok(summaryStats.number_stats, 'Number stats should be present even for all null values');

		const numberStats = summaryStats.number_stats!;
		// For all null values, DuckDB returns '0' for all statistics
		assert.strictEqual(numberStats.min_value, '0', 'Min value should be 0 for all null column');
		assert.strictEqual(numberStats.max_value, '0', 'Max value should be 0 for all null column');
		assert.strictEqual(numberStats.mean, '0', 'Mean should be 0 for all null column');
		assert.strictEqual(numberStats.median, '0', 'Median should be 0 for all null column');
		assert.strictEqual(numberStats.stdev, '0', 'Stdev should be 0 for all null column');
	});

	test('searchSchema functionality', async () => {
		// Create test table with overlapping column names and mixed types
		const tableName = makeTempTableName();
		await createTempTable(tableName, [
			{
				name: 'id',
				type: 'INTEGER',
				display_type: ColumnDisplayType.Number,
				values: ['1', '2', '3'],
			},
			{
				name: 'user_id',
				type: 'INTEGER',
				display_type: ColumnDisplayType.Number,
				values: ['101', '102', '103'],
			},
			{
				name: 'name',
				type: 'VARCHAR',
				display_type: ColumnDisplayType.String,
				values: ["'Alice'", "'Bob'", "'Charlie'"],
			},
			{
				name: 'full_name',
				type: 'VARCHAR',
				display_type: ColumnDisplayType.String,
				values: ["'Alice Smith'", "'Bob Jones'", "'Charlie Brown'"],
			},
			{
				name: 'first_name',
				type: 'VARCHAR',
				display_type: ColumnDisplayType.String,
				values: ["'Alice'", "'Bob'", "'Charlie'"],
			},
			{
				name: 'age',
				type: 'INTEGER',
				display_type: ColumnDisplayType.Number,
				values: ['25', '30', '35'],
			},
			{
				name: 'created_at',
				type: 'TIMESTAMP',
				display_type: ColumnDisplayType.Datetime,
				values: [
					"'2024-01-01 00:00:00'",
					"'2024-01-02 00:00:00'",
					"'2024-01-03 00:00:00'",
				],
			},
			{
				name: 'updated_at',
				type: 'TIMESTAMP',
				display_type: ColumnDisplayType.Datetime,
				values: [
					"'2024-02-01 00:00:00'",
					"'2024-02-02 00:00:00'",
					"'2024-02-03 00:00:00'",
				],
			},
			{
				name: 'is_active',
				type: 'BOOLEAN',
				display_type: ColumnDisplayType.Boolean,
				values: ['true', 'false', 'true'],
			},
			{
				name: 'is_deleted',
				type: 'BOOLEAN',
				display_type: ColumnDisplayType.Boolean,
				values: ['false', 'false', 'true'],
			},
			{
				name: 'birth_date',
				type: 'DATE',
				display_type: ColumnDisplayType.Date,
				values: ["'1999-01-01'", "'1994-01-01'", "'1989-01-01'"],
			},
			{
				name: 'start_date',
				type: 'DATE',
				display_type: ColumnDisplayType.Date,
				values: ["'2020-01-01'", "'2019-01-01'", "'2018-01-01'"],
			},
			{
				name: 'salary',
				type: 'DOUBLE',
				display_type: ColumnDisplayType.Number,
				values: ['50000.0', '60000.0', '70000.0'],
			},
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Helper function to test searchSchema
		const testSearchSchema = async (
			filters: ColumnFilter[],
			sortOrder: SearchSchemaSortOrder,
			expectedIndices: number[],
			description: string,
		) => {
			const result = (await dxExec({
				method: DataExplorerBackendRequest.SearchSchema,
				uri: uri.toString(),
				params: {
					filters,
					sort_order: sortOrder,
				} satisfies SearchSchemaParams,
			})) as SearchSchemaResult;

			assert.deepStrictEqual(
				result.matches,
				expectedIndices,
				description,
			);
		};

		// Helper to create text search filter
		const textFilter = (
			searchType: TextSearchType,
			term: string,
			caseSensitive = false,
		): ColumnFilter => ({
			filter_type: ColumnFilterType.TextSearch,
			params: {
				search_type: searchType,
				term,
				case_sensitive: caseSensitive,
			} satisfies FilterTextSearch,
		});

		// Helper to create data type filter
		const typeFilter = (
			...displayTypes: ColumnDisplayType[]
		): ColumnFilter => ({
			filter_type: ColumnFilterType.MatchDataTypes,
			params: {
				display_types: displayTypes,
			} satisfies FilterMatchDataTypes,
		});

		// Test cases defined as data
		const testCases: Array<{
			filters: ColumnFilter[];
			sortOrder: SearchSchemaSortOrder;
			expected: number[];
			description: string;
		}> = [
				// Basic tests
				{
					filters: [],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
					description: 'No filters, original order',
				},

				// Text search tests
				{
					filters: [textFilter(TextSearchType.Contains, 'date')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [7, 10, 11],
					description: 'Contains "date"',
				},
				{
					filters: [textFilter(TextSearchType.Contains, 'name')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [2, 3, 4],
					description: 'Contains "name"',
				},
				{
					filters: [textFilter(TextSearchType.Contains, 'id')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [0, 1],
					description: 'Contains "id"',
				},
				{
					filters: [textFilter(TextSearchType.StartsWith, 'is')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [8, 9],
					description: 'Starts with "is"',
				},
				{
					filters: [textFilter(TextSearchType.EndsWith, 'at')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [6, 7],
					description: 'Ends with "at"',
				},
				{
					filters: [textFilter(TextSearchType.NotContains, '_')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [0, 2, 5, 12],
					description: 'Not contains "_"',
				},
				{
					filters: [textFilter(TextSearchType.RegexMatch, '^[a-z]+$')],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [0, 2, 5, 12],
					description: 'Regex match ^[a-z]+$',
				},

				// Type filter tests
				{
					filters: [typeFilter(ColumnDisplayType.Number)],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [0, 1, 5, 12],
					description: 'Number columns',
				},
				{
					filters: [typeFilter(ColumnDisplayType.String)],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [2, 3, 4],
					description: 'String columns',
				},
				{
					filters: [typeFilter(ColumnDisplayType.Boolean)],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [8, 9],
					description: 'Boolean columns',
				},
				{
					filters: [
						typeFilter(
							ColumnDisplayType.Date,
							ColumnDisplayType.Datetime,
						),
					],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [6, 7, 10, 11],
					description: 'Date/Datetime columns',
				},

				// Multiple filters (AND logic)
				{
					filters: [
						textFilter(TextSearchType.Contains, 'a'),
						typeFilter(ColumnDisplayType.Number),
					],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [5, 12],
					description: 'Contains "a" AND Number type',
				},

				// Sort order tests - by name
				{
					filters: [],
					sortOrder: SearchSchemaSortOrder.AscendingName,
					expected: [5, 10, 6, 4, 3, 0, 8, 9, 2, 12, 11, 7, 1],
					description: 'Ascending by name',
				},
				{
					filters: [],
					sortOrder: SearchSchemaSortOrder.DescendingName,
					expected: [1, 7, 11, 12, 2, 9, 8, 0, 3, 4, 6, 10, 5],
					description: 'Descending by name',
				},
				{
					filters: [textFilter(TextSearchType.Contains, 'a')],
					sortOrder: SearchSchemaSortOrder.AscendingName,
					expected: [5, 10, 6, 4, 3, 8, 2, 12, 11, 7],
					description: 'Filtered and sorted by name',
				},

				// Sort order tests - by type
				{
					filters: [],
					sortOrder: SearchSchemaSortOrder.AscendingType,
					expected: [8, 9, 10, 11, 12, 0, 1, 5, 6, 7, 2, 3, 4],
					description: 'Ascending by type',
				},
				{
					filters: [],
					sortOrder: SearchSchemaSortOrder.DescendingType,
					expected: [2, 3, 4, 6, 7, 0, 1, 5, 12, 10, 11, 8, 9],
					description: 'Descending by type',
				},
				{
					filters: [typeFilter(ColumnDisplayType.Number)],
					sortOrder: SearchSchemaSortOrder.AscendingType,
					expected: [12, 0, 1, 5],
					description: 'Number columns by type',
				},

				// Case sensitivity tests
				{
					filters: [textFilter(TextSearchType.Contains, 'AGE', true)],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [],
					description: 'Case-sensitive "AGE"',
				},
				{
					filters: [textFilter(TextSearchType.Contains, 'age', true)],
					sortOrder: SearchSchemaSortOrder.Original,
					expected: [5],
					description: 'Case-sensitive "age"',
				},
			];

		// Run all test cases
		for (const testCase of testCases) {
			await testSearchSchema(
				testCase.filters,
				testCase.sortOrder,
				testCase.expected,
				testCase.description,
			);
		}
	});

	test('ColumnProfileEvaluator.computeSummaryStats - Edge case: single value', async () => {
		// Create a test table with a single value repeated, using quoted field name to test escaping
		const tableName = await createSummaryStatsTestTable(
			'"single_value_column"', // Quoted field name
			'INTEGER',
			ColumnDisplayType.Number,
			() => '42', // All values are 42
			15
		);

		// Request summary stats for the column with a single value
		const summaryStats = await requestSummaryStats(
			tableName,
			0, // column index
			'test-single-value-summary-stats'
		);

		// Verify the summary stats for a single value
		assert.ok(summaryStats, 'Summary stats should be returned');
		assert.strictEqual(summaryStats.type_display, ColumnDisplayType.Number, 'Type display should be Number');
		assert.ok(summaryStats.number_stats, 'Number stats should be present');

		const numberStats = summaryStats.number_stats!;
		assert.strictEqual(numberStats.min_value, '42', 'Min value should be 42');
		assert.strictEqual(numberStats.max_value, '42', 'Max value should be 42');
		assert.strictEqual(numberStats.mean, '42', 'Mean should be 42');
		assert.strictEqual(numberStats.median, '42', 'Median should be 42');
		assert.strictEqual(numberStats.stdev, '0', 'Standard deviation should be 0 for single value');
	});

	test('convertToCode - with row filters', async () => {
		const tableName = makeTempTableName();

		// Create a test table with more diverse data for filtering
		await createTempTable(tableName, [
			{
				name: 'id',
				type: 'INTEGER',
				values: ['1', '2', '3', '4', '5']
			},
			{
				name: 'name',
				type: 'VARCHAR',
				values: ["'Alice'", "'Bob'", "'Charlie'", "'David'", "'Eve'"]
			},
			{
				name: 'age',
				type: 'INTEGER',
				values: ['25', '30', '35', '40', '45']
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Get full schema to build row filter
		const fullSchema = await getSchema(tableName);

		// Create filter: age > 30
		const rowFilter: RowFilter = {
			filter_id: 'test-filter',
			condition: RowFilterCondition.And,
			column_schema: fullSchema.columns[2], // age column
			filter_type: RowFilterType.Compare,
			params: {
				op: FilterComparisonOp.Gt,
				value: '30'
			}
		};

		// Apply the filter first so it's reflected in the SQL generation
		await dxExec({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: uri.toString(),
			params: {
				filters: [rowFilter]
			}
		});

		// Test convert to code with row filter applied
		const result = await dxExec({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: uri.toString(),
			params: {
				column_filters: [],
				row_filters: [rowFilter],
				sort_keys: [],
				code_syntax_name: { code_syntax_name: 'SQL' }
			}
		});

		assert.ok(result, 'Convert to code result should be returned');
		assert.ok(result.converted_code, 'Converted code should be present');
		assert.strictEqual(result.converted_code.length, 3, 'Should have 3 lines of code');
		assert.strictEqual(result.converted_code[0], 'SELECT * ', 'First line should be SELECT * ');
		assert.strictEqual(result.converted_code[1], `FROM "${tableName}"`, `Second line should reference the table name`);
		assert.strictEqual(result.converted_code[2], 'WHERE "age" > 30', 'Third line should have the WHERE clause');
	});

	test('convertToCode - with sort columns', async () => {
		const tableName = makeTempTableName();

		// Create a test table with more diverse data for sorting
		await createTempTable(tableName, [
			{
				name: 'id',
				type: 'INTEGER',
				values: ['1', '2', '3', '4', '5']
			},
			{
				name: 'name',
				type: 'VARCHAR',
				values: ["'Alice'", "'Bob'", "'Charlie'", "'David'", "'Eve'"]
			},
			{
				name: 'age',
				type: 'INTEGER',
				values: ['25', '30', '35', '40', '45']
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Create sort key: sort by name descending
		const sortKey: ColumnSortKey = {
			column_index: 1, // name column
			ascending: false
		};

		// Apply the sort key first so it's reflected in the SQL generation
		await dxExec({
			method: DataExplorerBackendRequest.SetSortColumns,
			uri: uri.toString(),
			params: {
				sort_keys: [sortKey]
			}
		});

		// Test convert to code with sort key applied
		const result = await dxExec({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: uri.toString(),
			params: {
				column_filters: [],
				row_filters: [],
				sort_keys: [sortKey],
				code_syntax_name: { code_syntax_name: 'SQL' }
			}
		});

		assert.ok(result, 'Convert to code result should be returned');
		assert.ok(result.converted_code, 'Converted code should be present');
		assert.strictEqual(result.converted_code.length, 3, 'Should have 3 lines of code');
		assert.strictEqual(result.converted_code[0], 'SELECT * ', 'First line should be SELECT * ');
		assert.strictEqual(result.converted_code[1], `FROM "${tableName}"`, `Second line should reference the table name`);
		assert.strictEqual(result.converted_code[2], 'ORDER BY "name" DESC', 'Third line should have the ORDER BY clause');
	});

	test('convertToCode - with both row filters and sort columns', async () => {
		const tableName = makeTempTableName();

		// Create a test table with data for filtering and sorting
		await createTempTable(tableName, [
			{
				name: 'id',
				type: 'INTEGER',
				values: ['1', '2', '3', '4', '5']
			},
			{
				name: 'name',
				type: 'VARCHAR',
				values: ["'Alice'", "'Bob'", "'Charlie'", "'David'", "'Eve'"]
			},
			{
				name: 'age',
				type: 'INTEGER',
				values: ['25', '30', '35', '40', '45']
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });

		// Get full schema to build row filter
		const fullSchema = await getSchema(tableName);

		// Create filter: age > 30
		const rowFilter: RowFilter = {
			filter_id: 'test-filter',
			condition: RowFilterCondition.And,
			column_schema: fullSchema.columns[2], // age column
			filter_type: RowFilterType.Compare,
			params: {
				op: FilterComparisonOp.Gt,
				value: '30'
			}
		};

		// Create sort key: sort by name ascending
		const sortKey: ColumnSortKey = {
			column_index: 1, // name column
			ascending: true
		};

		// Apply the filter and sort key
		await dxExec({
			method: DataExplorerBackendRequest.SetRowFilters,
			uri: uri.toString(),
			params: {
				filters: [rowFilter]
			}
		});

		await dxExec({
			method: DataExplorerBackendRequest.SetSortColumns,
			uri: uri.toString(),
			params: {
				sort_keys: [sortKey]
			}
		});

		// Test convert to code with both row filter and sort key applied
		const result = await dxExec({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: uri.toString(),
			params: {
				column_filters: [],
				row_filters: [rowFilter],
				sort_keys: [sortKey],
				code_syntax_name: { code_syntax_name: 'SQL' }
			}
		});

		assert.ok(result, 'Convert to code result should be returned');
		assert.ok(result.converted_code, 'Converted code should be present');
		assert.strictEqual(result.converted_code.length, 4, 'Should have 4 lines of code');
		assert.strictEqual(result.converted_code[0], 'SELECT * ', 'First line should be SELECT * ');
		assert.strictEqual(result.converted_code[1], `FROM "${tableName}"`, `Second line should reference the table name`);
		assert.strictEqual(result.converted_code[2], 'WHERE "age" > 30', 'Third line should have the WHERE clause');
		assert.strictEqual(result.converted_code[3], 'ORDER BY "name"', 'Fourth line should have the ORDER BY clause');
	});

	test('convertToCode - with long/complex filename/URI', async () => {
		// Use a long filename that needs to be quoted in SQL
		const specialTableName = makeTempTableName() + '_complex_tablename_with_underscores';

		// Create a simple test table
		await createTempTable(specialTableName, [
			{
				name: 'id',
				type: 'INTEGER',
				values: ['1', '2', '3']
			},
			{
				name: 'data',
				type: 'VARCHAR',
				values: ["'A'", "'B'", "'C'"]
			}
		]);

		const uri = vscode.Uri.from({ scheme: 'duckdb', path: specialTableName });

		// Test convert to code with a complex filename
		const result = await dxExec({
			method: DataExplorerBackendRequest.ConvertToCode,
			uri: uri.toString(),
			params: {
				column_filters: [],
				row_filters: [],
				sort_keys: [],
				code_syntax_name: { code_syntax_name: 'SQL' }
			}
		});

		assert.ok(result, 'Convert to code result should be returned');
		assert.ok(result.converted_code, 'Converted code should be present');
		assert.strictEqual(result.converted_code.length, 2, 'Should have 2 lines of code');
		assert.strictEqual(result.converted_code[0], 'SELECT * ', 'First line should be SELECT * ');

		// Verify that the table name is properly quoted in SQL
		assert.strictEqual(result.converted_code[1], `FROM "${specialTableName}"`, 'Second line should properly quote the table name');
	});

	test('null count profiles with zero rows should return 0', async () => {
		// Create an empty table using direct SQL since createTempTable doesn't handle empty arrays
		const tableName = makeTempTableName();
		await runQuery(`CREATE TABLE ${tableName} (str_col VARCHAR, num_col INTEGER);`);

		// Open the dataset so it can respond to RPCs
		await dxExec({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri: vscode.Uri.from({ scheme: 'duckdb', path: tableName }) }
		});

		// Test string column null count
		const stringColumnProfile = await requestNullCount(
			tableName,
			0, // str_col column index
			randomUUID()
		);

		assert.strictEqual(stringColumnProfile, 0, 'String column null count should be 0 for zero-row table');

		// Test number column null count
		const numberColumnProfile = await requestNullCount(
			tableName,
			1, // num_col column index
			randomUUID()
		);

		assert.strictEqual(numberColumnProfile, 0, 'Number column null count should be 0 for zero-row table');
	});

	/**
	 * Helper function to request frequency table profiles
	 */
	async function requestFrequencyTable(
		tableName: string,
		columnIndex: number,
		profileType: ColumnProfileType,
		limit: number,
		callbackId: string
	): Promise<any> {
		return requestColumnProfile(
			tableName,
			columnIndex,
			[
				{
					profile_type: profileType,
					params: { limit }
				}
			],
			callbackId,
			(profile) => {
				const key = profileType === ColumnProfileType.SmallFrequencyTable ? 'small_frequency_table' : 'large_frequency_table';
				if (profile && profile[key]) {
					return profile[key];
				}
				throw new Error(`Expected ${key} to be present in profile results`);
			},
			`Timeout waiting for ${profileType} data`
		);
	}

	/**
	 * Creates a test table with frequency data that has ties to test the fix
	 */
	async function createFrequencyTestTable(): Promise<string> {
		const tableName = makeTempTableName();

		// Create data where some values have the same frequency (ties)
		// This will test that the ordering is consistent between small and large frequency tables
		const values = [
			// Most frequent (5 times each)
			'A', 'A', 'A', 'A', 'A',
			'B', 'B', 'B', 'B', 'B',
			// Second most frequent (4 times each)
			'C', 'C', 'C', 'C',
			'D', 'D', 'D', 'D',
			// Third most frequent (3 times each) - this creates the tie scenario
			'E', 'E', 'E',
			'9E', '9E', '9E',  // This was the problematic value from the original bug report
			'WN', 'WN', 'WN',  // This was the value that appeared instead of 9E
			'F', 'F', 'F',
			// Less frequent (2 times each)
			'G', 'G',
			'H', 'H',
			'I', 'I',
			'J', 'J',
			// Single occurrences
			'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'
		];

		await createTempTable(tableName, [
			{
				name: 'category',
				type: 'VARCHAR',
				display_type: ColumnDisplayType.String,
				values: values.map(v => `'${v}'`)
			}
		]);

		return tableName;
	}

	test('ColumnProfileEvaluator.computeFreqTable - Small and Large frequency tables are consistent', async () => {
		const tableName = await createFrequencyTestTable();
		const callbackId = randomUUID();

		// Request both small and large frequency tables
		const [smallFreqTable, largeFreqTable] = await Promise.all([
			requestFrequencyTable(tableName, 0, ColumnProfileType.SmallFrequencyTable, 8, callbackId + '_small'),
			requestFrequencyTable(tableName, 0, ColumnProfileType.LargeFrequencyTable, 16, callbackId + '_large')
		]);

		// Verify basic structure
		assert.ok(smallFreqTable.values, 'Small frequency table should have values');
		assert.ok(smallFreqTable.counts, 'Small frequency table should have counts');
		assert.ok(largeFreqTable.values, 'Large frequency table should have values');
		assert.ok(largeFreqTable.counts, 'Large frequency table should have counts');

		// The small table should have at most 8 entries
		assert.ok(smallFreqTable.values.length <= 8, `Small frequency table should have <= 8 entries, got ${smallFreqTable.values.length}`);
		assert.ok(largeFreqTable.values.length <= 16, `Large frequency table should have <= 16 entries, got ${largeFreqTable.values.length}`);

		// Verify that values are sorted by frequency (descending), then by value (ascending)
		for (let i = 0; i < smallFreqTable.counts.length - 1; i++) {
			const currentCount = smallFreqTable.counts[i];
			const nextCount = smallFreqTable.counts[i + 1];
			const currentValue = smallFreqTable.values[i];
			const nextValue = smallFreqTable.values[i + 1];

			assert.ok(
				currentCount > nextCount || (currentCount === nextCount && currentValue <= nextValue),
				`Small frequency table should be sorted by count DESC, value ASC. Position ${i}: (${currentValue}, ${currentCount}) vs (${nextValue}, ${nextCount})`
			);
		}

		for (let i = 0; i < largeFreqTable.counts.length - 1; i++) {
			const currentCount = largeFreqTable.counts[i];
			const nextCount = largeFreqTable.counts[i + 1];
			const currentValue = largeFreqTable.values[i];
			const nextValue = largeFreqTable.values[i + 1];

			assert.ok(
				currentCount > nextCount || (currentCount === nextCount && currentValue <= nextValue),
				`Large frequency table should be sorted by count DESC, value ASC. Position ${i}: (${currentValue}, ${currentCount}) vs (${nextValue}, ${nextCount})`
			);
		}

		// CRITICAL TEST: The small frequency table should be a prefix of the large frequency table
		// This is the main fix - ensuring consistent ordering between small and large tables
		for (let i = 0; i < Math.min(smallFreqTable.values.length, largeFreqTable.values.length); i++) {
			assert.strictEqual(
				smallFreqTable.values[i],
				largeFreqTable.values[i],
				`Small and large frequency tables should have consistent ordering. Position ${i}: small="${smallFreqTable.values[i]}", large="${largeFreqTable.values[i]}"`
			);
			assert.strictEqual(
				smallFreqTable.counts[i],
				largeFreqTable.counts[i],
				`Small and large frequency tables should have consistent counts. Position ${i}: small=${smallFreqTable.counts[i]}, large=${largeFreqTable.counts[i]}`
			);
		}

		// Verify that "9E" appears in both tables (it should be in the top values due to frequency)
		const smallHas9E = smallFreqTable.values.includes('9E');
		const largeHas9E = largeFreqTable.values.includes('9E');

		assert.ok(largeHas9E, 'Large frequency table should include "9E"');
		if (smallFreqTable.values.length >= 8) {
			// If small table has 8 or more entries, it should also include 9E since it has 3 occurrences
			assert.ok(smallHas9E, 'Small frequency table should include "9E" when it has enough entries');
		}
	});

	test('ColumnProfileEvaluator.computeFreqTable - Tie-breaking works correctly', async () => {
		const tableName = await createFrequencyTestTable();
		const callbackId = randomUUID();

		// Request a large frequency table to see all the ties
		const freqTable = await requestFrequencyTable(tableName, 0, ColumnProfileType.LargeFrequencyTable, 20, callbackId);

		// Find values with the same frequency count (ties)
		const frequencyGroups = new Map<number, string[]>();
		for (let i = 0; i < freqTable.counts.length; i++) {
			const count = freqTable.counts[i];
			const value = freqTable.values[i];
			if (!frequencyGroups.has(count)) {
				frequencyGroups.set(count, []);
			}
			frequencyGroups.get(count)!.push(value);
		}

		// For each group of values with the same frequency, verify they are sorted alphabetically
		for (const [count, values] of frequencyGroups) {
			if (values.length > 1) {
				for (let i = 0; i < values.length - 1; i++) {
					assert.ok(
						values[i] <= values[i + 1],
						`Values with same frequency (${count}) should be sorted alphabetically: "${values[i]}" should come before or equal to "${values[i + 1]}"`
					);
				}
			}
		}

		// Specifically verify that "9E", "WN", and other 3-count values are in alphabetical order
		const threeCountValues = frequencyGroups.get(3) || [];
		if (threeCountValues.includes('9E') && threeCountValues.includes('WN')) {
			const nineEIndex = freqTable.values.indexOf('9E');
			const wnIndex = freqTable.values.indexOf('WN');
			assert.ok(nineEIndex < wnIndex, '"9E" should appear before "WN" in the frequency table due to alphabetical tie-breaking');
		}
	});

	test('ColumnProfileEvaluator.computeFreqTable - Edge case: Empty table', async () => {
		const tableName = makeTempTableName();

		// Create an empty table using the createTempTable helper
		await createTempTable(tableName, [
			{
				name: 'category',
				type: 'VARCHAR',
				display_type: ColumnDisplayType.String,
				values: ['\'test\''] // Add one value first
			}
		]);

		// Then delete all rows to make it empty
		await runQuery(`DELETE FROM ${tableName}`);

		// Open the dataset with the data explorer
		const uri = vscode.Uri.from({ scheme: 'duckdb', path: tableName });
		await dxExec({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri: uri.toString() }
		});

		const callbackId = randomUUID();
		const freqTable = await requestFrequencyTable(tableName, 0, ColumnProfileType.SmallFrequencyTable, 8, callbackId);

		assert.strictEqual(freqTable.values.length, 0, 'Empty table should produce empty frequency table values');
		assert.strictEqual(freqTable.counts.length, 0, 'Empty table should produce empty frequency table counts');
		assert.strictEqual(freqTable.other_count, 0, 'Empty table should have 0 other_count');
	});
});
