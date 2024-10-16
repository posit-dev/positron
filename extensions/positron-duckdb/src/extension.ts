/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	BackendState,
	ColumnDisplayType,
	ColumnProfileResult,
	ColumnProfileType,
	DataExplorerBackendRequest,
	DataExplorerFrontendEvent,
	DataExplorerResponse,
	DataExplorerRpc,
	DataExplorerUiEvent,
	FilterResult,
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetRowLabelsParams,
	GetSchemaParams,
	OpenDatasetParams,
	OpenDatasetResult,
	ReturnColumnProfilesEvent,
	SetRowFiltersParams,
	SupportStatus,
	TableData,
	TableRowLabels,
	TableSchema
} from './interfaces';
import * as duckdb from '@duckdb/duckdb-wasm';
import Worker from 'web-worker';
import { basename, extname, join } from 'path';
import { Table } from 'apache-arrow';

class DuckDBInstance {
	constructor(readonly db: duckdb.AsyncDuckDB, readonly con: duckdb.AsyncDuckDBConnection) { }

	static async create(ctx: vscode.ExtensionContext): Promise<DuckDBInstance> {
		// Create the path to the DuckDB WASM bundle. Note that only the MVP
		// bundle for Node is supported for now as we don't support Positron
		// extensions running in a browser context yet.
		const distPath = join(ctx.extensionPath, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
		const bundle = {
			mainModule: join(distPath, 'duckdb-mvp.wasm'),
			mainWorker: join(distPath, 'duckdb-node-mvp.worker.cjs')
		};
		const logger = new duckdb.VoidLogger();

		const worker = new Worker(bundle.mainWorker);

		const db = new duckdb.AsyncDuckDB(logger, worker);
		await db.instantiate(bundle.mainModule, null);

		const con = await db.connect();
		await con.query('LOAD icu; SET TIMEZONE=\'UTC\';');
		return new DuckDBInstance(db, con);
	}

	public async runQuery(query: string) {
		return this.con.query(query);
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
const SENTINEL_NEGINF = 10;

/**
 * Implementation of Data Explorer backend protocol using duckdb-wasm,
 * for serving requests coming in through the vscode command.
 */
export class DataExplorerRpcHandler {

	// TODO
	// - Decimal
	// - Nested types
	// - JSON
	private readonly _displayTypeMapping = new Map<string, ColumnDisplayType>([
		['BOOLEAN', ColumnDisplayType.Boolean],
		['TINYINT', ColumnDisplayType.Number],
		['SMALLINT', ColumnDisplayType.Number],
		['INTEGER', ColumnDisplayType.Number],
		['BIGINT', ColumnDisplayType.Number],
		['FLOAT', ColumnDisplayType.Number],
		['DOUBLE', ColumnDisplayType.Number],
		['VARCHAR', ColumnDisplayType.String],
		['UUID', ColumnDisplayType.String],
		['DATE', ColumnDisplayType.Date],
		['TIMESTAMP', ColumnDisplayType.Datetime],
		['TIMESTAMP WITH TIME ZONE', ColumnDisplayType.Datetime],
		['TIME', ColumnDisplayType.Time]
	]);

	private readonly _uriToSchema = new Map<string, Array<SchemaEntry>>();
	private readonly _uriToTableName = new Map<string, string>();
	private readonly _uriToUnfilteredShape = new Map<string, [number, number]>();
	private _tableIndex: number = 0;

	constructor(private readonly db: DuckDBInstance) { }

	private async runQuery(query: string): Promise<Table<any> | string> {
		// console.log(query);
		try {
			const result = await this.db.runQuery(query);
			return result;
		} catch (error) {
			console.error(error);
			return JSON.stringify(error);
		}
	}

	async openDataset(params: OpenDatasetParams): Promise<OpenDatasetResult> {
		const tableName = `positron_${this._tableIndex++}`;
		this._uriToTableName.set(params.uri, tableName);
		const fileExt = extname(params.uri);

		// console.log(`Opening ${params.uri}`);

		let scanOperation;
		switch (fileExt) {
			case '.parquet':
			case '.parq':
				scanOperation = `parquet_scan('${params.uri}')`;
				break;
			// TODO: Will need to be able to pass CSV / TSV options from the
			// UI at some point.
			case '.csv':
				scanOperation = `read_csv('${params.uri}')`;
				break;
			case '.tsv':
				scanOperation = `read_csv('${params.uri}', delim='\t')`;
				break;
			default:
				return { error_message: `Unsupported file extension: ${fileExt}` };
		}

		const ctasQuery = `
		CREATE TABLE ${tableName} AS
		SELECT * FROM ${scanOperation}`;

		let result = await this.runQuery(ctasQuery);
		if (typeof result === 'string') {
			return { error_message: result };
		}

		const schemaQuery = `DESCRIBE ${tableName};`;
		result = await this.runQuery(schemaQuery);
		if (typeof result === 'string') {
			return { error_message: result };
		}

		this._uriToSchema.set(params.uri, result.toArray());

		return {};
	}

	async getSchema(uri: string, params: GetSchemaParams): RpcResponse<TableSchema> {
		const schema = this.getCachedSchema(uri);
		return {
			columns: params.column_indices.map((index) => {
				const entry = schema[index];
				let type_display = this._displayTypeMapping.get(entry.column_type);
				if (type_display === undefined) {
					type_display = ColumnDisplayType.Unknown;
				}
				return {
					column_name: entry.column_name,
					column_index: index,
					type_name: entry.column_type,
					type_display
				};
			})
		};
	}

	async getDataValues(uri: string, params: GetDataValuesParams): RpcResponse<TableData> {
		const fullSchema = this.getCachedSchema(uri);

		// Because DuckDB is a SQL engine, we opt to always select a row range of
		// formatted data for a range of rows, and then return the requested selections
		// based on what the UI requested. This blunt approach could end up being wasteful in
		// some cases, but doing fewer queries / scans in the average case should yield better
		// performance.
		let lowerLimit = Infinity;
		let upperLimit = -Infinity;

		const columnSelectors: Array<string> = [];
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

			const columnSchema = fullSchema[column.column_index];
			const quotedName = `"${columnSchema.column_name}"`;

			// TODO: what is column_index is out of bounds?

			// Build column selector. Just casting to string for now
			let columnSelector;
			switch (columnSchema.column_type) {
				case 'VARCHAR':
					columnSelector = quotedName;
					break;
				case 'TIMESTAMP':
					columnSelector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
					break;
				default:
					columnSelector = `CAST(${quotedName} AS VARCHAR)`;
					break;
			}
			columnSelectors.push(columnSelector);
		}
		const tableName = this.getTableName(uri);

		let numRows = 0;
		if (isFinite(lowerLimit) && isFinite(upperLimit)) {
			// Limits are inclusive
			numRows = upperLimit - lowerLimit + 1;
		}

		// No column selectors case -- TODO: why is the backend even sending this?
		if (columnSelectors.length === 0) {
			return { columns: [] };
		} else if (numRows === 0) {
			return {
				columns: Array.from({ length: params.columns.length }, () => [])
			};
		}

		const query = `select ${columnSelectors.join(',\n    ')}
		FROM ${tableName}
		LIMIT ${numRows}
		OFFSET ${lowerLimit}`;

		const queryResult = await this.runQuery(query);
		if (typeof queryResult === 'string') {
			// query error
			return queryResult;
		}

		// Sanity checks
		if (queryResult.numCols !== params.columns.length) {
			return 'Incorrect number of columns in query result';
		}

		if (queryResult.numRows !== numRows) {
			return 'Incorrect number of rows in query result';
		}

		const result: TableData = {
			columns: []
		};

		for (let i = 0; i < queryResult.numCols; i++) {
			const spec = params.columns[i].spec;

			const field = queryResult.getChildAt(i)!;
			const values: Array<string> = field.toArray();

			if ('first_index' in spec) {
				const columnValues: Array<string | number> = [];

				// Value range, we need to extract the actual slice requested
				for (let i = spec.first_index; i <= spec.last_index; ++i) {
					const relIndex = i - lowerLimit;
					if (field.isValid(relIndex)) {
						columnValues.push(values[relIndex]);
					} else {
						columnValues.push(SENTINEL_NULL);
					}
				}
				result.columns.push(columnValues);
			} else {
				// Set of values indices, just get the lower and upper extent
				result.columns.push(
					spec.indices.map((index) => {
						const value = values[index - lowerLimit];
						if (value === null) {
							return SENTINEL_NULL;
						} else {
							return value;
						}
					})
				);
			}
		}

		return result;
	}

	async getRowLabels(uri: string, params: GetRowLabelsParams): RpcResponse<TableRowLabels> {
		return 'not implemented';
	}

	async getState(uri: string): RpcResponse<BackendState> {
		const [num_rows, num_columns] = await this._getUnfilteredShape(uri);
		return {
			display_name: basename(uri),
			table_shape: { num_rows, num_columns },
			table_unfiltered_shape: { num_rows, num_columns },
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
		};
	}

	async getColumnProfiles(uri: string, params: GetColumnProfilesParams): RpcResponse<void> {
		// Initiate but do not await profile evaluations
		this._evaluateColumnProfiles(uri, params);
	}

	private async _evaluateColumnProfiles(uri: string, params: GetColumnProfilesParams) {
		const tableName = this.getTableName(uri);
		const fullSchema = this.getCachedSchema(uri);

		const profileExprs: Array<string> = [];
		const queryResultIds: Array<Array<number | undefined>> = [];

		let resultIndex = 0;
		for (const request of params.profiles) {
			const columnSchema = fullSchema[request.column_index];
			const quotedName = `"${columnSchema.column_name}"`;
			const resultIds: Array<number | undefined> = [];
			request.profiles.map((profile, index) => {
				let profileExpr;
				switch (profile.profile_type) {
					case ColumnProfileType.NullCount:
						profileExpr = `COUNT(*) - COUNT(${quotedName})`;
						break;
					default:
						// signal that no result is expected
						resultIds.push(undefined);
						return;
				}
				profileExprs.push(`${profileExpr} AS profile_${resultIndex}`);
				resultIds.push(resultIndex++);
			});
			queryResultIds.push(resultIds);
		}

		let result;
		if (profileExprs.length > 0) {
			const profileQuery = `
			SELECT ${profileExprs.join(',\n    ')}
			FROM ${tableName}`;
			result = await this.runQuery(profileQuery);
			if (typeof result === 'string') {
				// Query failed for some reason, need to return to UI
				return;
			}
		} else {
			// Do not run any malformed queries
			result = undefined;
		}

		// Now need to populate the result
		const response: ReturnColumnProfilesEvent = {
			callback_id: params.callback_id,
			profiles: params.profiles.map((request, requestIndex) => {
				const outputIds = queryResultIds[requestIndex];
				const requestResult: ColumnProfileResult = {};
				request.profiles.map((spec, profIndex) => {
					const outputIndex = outputIds[profIndex];

					// A requested profile was not implemented, so we just skip it
					if (outputIndex === undefined || result === undefined) {
						return;
					}

					const profResult = result.getChildAt(outputIndex)?.get(0) as any;

					// Now copy the result into its intended place
					switch (spec.profile_type) {
						case ColumnProfileType.NullCount:
							requestResult.null_count = Number(profResult);
							break;
						default:
							break;
					}
				});
				return requestResult;
			})
		};

		await vscode.commands.executeCommand(
			'positron-data-explorer.sendUiEvent', {
				uri,
				method: DataExplorerFrontendEvent.ReturnColumnProfiles,
				params: response
			} satisfies DataExplorerUiEvent
		);
	}

	async setRowFilters(uri: string, params: SetRowFiltersParams): RpcResponse<FilterResult> {
		return 'not implemented';
	}

	private async _getUnfilteredShape(uri: string) {
		const schema = this.getCachedSchema(uri);
		const numColumns = schema.length;

		const tableName = this.getTableName(uri);
		const countStar = `SELECT count(*) AS num_rows FROM ${tableName} `;

		const result = await this.runQuery(countStar);

		let numRows: number;
		if (typeof result === 'string') {
			numRows = 0;
		} else {
			// The count comes back as BigInt
			numRows = Number(result.toArray()[0].num_rows);
		}
		return [numRows, numColumns];
	}

	getTableName(uri: string): string {
		return this._uriToTableName.get(uri) as string;
	}

	private getCachedSchema(uri: string): Array<SchemaEntry> {
		return this._uriToSchema.get(uri) as Array<SchemaEntry>;
	}

	async handleRequest(rpc: DataExplorerRpc): Promise<DataExplorerResponse> {
		const resp = await this._dispatchRpc(rpc);
		if (typeof resp === 'string') {
			return { error_message: resp };
		} else {
			return { result: resp };
		}
	}

	private async _dispatchRpc(rpc: DataExplorerRpc): RpcResponse<any> {
		if (rpc.method === DataExplorerBackendRequest.OpenDataset) {
			return this.openDataset(rpc.params as OpenDatasetParams);
		}

		if (rpc.uri === undefined) {
			return `URI for open dataset must be provided: ${rpc.method} `;
		}
		switch (rpc.method) {
			case DataExplorerBackendRequest.GetSchema:
				return this.getSchema(rpc.uri, rpc.params as GetSchemaParams);
			case DataExplorerBackendRequest.GetDataValues:
				return this.getDataValues(rpc.uri, rpc.params as GetDataValuesParams);
			case DataExplorerBackendRequest.GetRowLabels:
				return this.getRowLabels(rpc.uri, rpc.params as GetRowLabelsParams);
			case DataExplorerBackendRequest.GetState:
				return this.getState(rpc.uri);
			case DataExplorerBackendRequest.SetRowFilters:
				return this.setRowFilters(rpc.uri, rpc.params as SetRowFiltersParams);
			case DataExplorerBackendRequest.GetColumnProfiles:
				return this.getColumnProfiles(rpc.uri, rpc.params as GetColumnProfilesParams);
			case DataExplorerBackendRequest.ExportDataSelection:
			case DataExplorerBackendRequest.SetColumnFilters:
			case DataExplorerBackendRequest.SetSortColumns:
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
				try {
					const result = await db.runQuery(query);
					return result.toArray();
				} catch (error) {
					console.error('DuckDB error:', error);
				}
			})
	);

	const dataExplorerHandler = new DataExplorerRpcHandler(db);
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-duckdb.dataExplorerRpc',
			async (rpc: DataExplorerRpc): Promise<DataExplorerResponse> => {
				return dataExplorerHandler.handleRequest(rpc);
			})
	);
}

export function deactivate() { }
