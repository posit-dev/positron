/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Table } from 'apache-arrow';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ColumnDisplayType, ColumnProfileType, ColumnSchema, DataExplorerBackendRequest, DataExplorerResponse, DataExplorerRpc, GetSchemaParams, SupportStatus, TableSchema } from '../interfaces';

suite('Positron DuckDB Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	// Not sure why it is not possible to use Mocha's 'before' for this
	async function activateExtension() {
		const extension = vscode.extensions.getExtension('vscode.positron-duckdb');
		await extension?.activate();  // Ensure the extension is activated
	}

	async function runQuery<Type>(query: string): Promise<Array<Type>> {
		await activateExtension();
		return vscode.commands.executeCommand('positron-duckdb.runQuery', query);
	}

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

	test('DuckDB flights.parquet', async () => {
		const uri = path.join(__dirname, 'data', 'flights.parquet');

		let result = await dxExec({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri }
		});
		assert.deepStrictEqual(result, {});

		result = await dxExec({
			method: DataExplorerBackendRequest.GetState,
			uri,
			params: {}
		});
		assert.deepStrictEqual(result, {
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
					support_status: SupportStatus.Unsupported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: []
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
				set_sort_columns: { support_status: SupportStatus.Unsupported, },
				export_data_selection: {
					support_status: SupportStatus.Unsupported,
					supported_formats: []
				}
			}
		});

		result = await dxExec({
			method: DataExplorerBackendRequest.GetSchema,
			uri,
			params: {
				column_indices: Array.from({ length: 19 }, (_, index) => index)
			} satisfies GetSchemaParams
		});

		const expectedSchema: Array<ColumnSchema> = [
			{
				column_name: 'year',
				column_index: 0,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'month',
				column_index: 1,
				type_name: 'TINYINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'day',
				column_index: 2,
				type_name: 'TINYINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'dep_time',
				column_index: 3,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'sched_dep_time',
				column_index: 4,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'dep_delay',
				column_index: 5,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'arr_time',
				column_index: 6,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'sched_arr_time',
				column_index: 7,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'arr_delay',
				column_index: 8,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'carrier',
				column_index: 9,
				type_name: 'VARCHAR',
				type_display: ColumnDisplayType.String
			},
			{
				column_name: 'flight',
				column_index: 10,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'tailnum',
				column_index: 11,
				type_name: 'VARCHAR',
				type_display: ColumnDisplayType.String
			},
			{
				column_name: 'origin',
				column_index: 12,
				type_name: 'VARCHAR',
				type_display: ColumnDisplayType.String
			},
			{
				column_name: 'dest',
				column_index: 13,
				type_name: 'VARCHAR',
				type_display: ColumnDisplayType.String
			},
			{
				column_name: 'air_time',
				column_index: 14,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'distance',
				column_index: 15,
				type_name: 'SMALLINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'hour',
				column_index: 16,
				type_name: 'TINYINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'minute',
				column_index: 17,
				type_name: 'TINYINT',
				type_display: ColumnDisplayType.Number
			},
			{
				column_name: 'time_hour',
				column_index: 18,
				type_name: 'TIMESTAMP_NS',
				type_display: ColumnDisplayType.Datetime
			}
		];

		assert.deepStrictEqual(result, {
			columns: expectedSchema
		} satisfies TableSchema);
	});
});
