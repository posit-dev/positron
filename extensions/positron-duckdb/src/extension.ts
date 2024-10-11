/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	BackendState,
	ColumnDisplayType,
	ColumnFilter,
	ColumnProfileResult,
	ColumnProfileType,
	ColumnSortKey,
	DataExplorerBackendRequest,
	DataExplorerFrontendEvent,
	DataExplorerResponse,
	DataExplorerRpc,
	DataExplorerUiEvent,
	ExportDataSelectionParams,
	ExportedData,
	FilterResult,
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetRowLabelsParams,
	GetSchemaParams,
	OpenDatasetParams,
	OpenDatasetResult,
	ReturnColumnProfilesEvent,
	RowFilter,
	SetRowFiltersParams,
	SetSortColumnsParams,
	SupportStatus,
	TableData,
	TableRowLabels,
	TableSchema
} from './interfaces';
import * as duckdb from '@duckdb/duckdb-wasm';
import * as path from 'path';
import Worker from 'web-worker';
import { Table } from 'apache-arrow';
import { pathToFileURL } from 'url';

class DuckDBInstance {
	constructor(readonly db: duckdb.AsyncDuckDB, readonly con: duckdb.AsyncDuckDBConnection) { }

	static async create(ctx: vscode.ExtensionContext): Promise<DuckDBInstance> {
		// Create the path to the DuckDB WASM bundle. Note that only the EH
		// bundle for Node is used for now as we don't support Positron
		// extensions running in a browser context yet.
		const distPath = path.join(ctx.extensionPath, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
		const bundle = {
			mainModule: path.join(distPath, 'duckdb-eh.wasm'),
			mainWorker: path.join(distPath, 'duckdb-node-eh.worker.cjs')
		};

		// On Windows, we need to call pathToFileURL on mainWorker because the web-worker package
		// does not support Windows paths that start with a drive letter.
		if (process.platform === 'win32') {
			bundle.mainWorker = pathToFileURL(bundle.mainWorker).toString();
		}

		const worker = new Worker(bundle.mainWorker);
		const logger = new duckdb.VoidLogger();
		const db = new duckdb.AsyncDuckDB(logger, worker);
		await db.instantiate(bundle.mainModule);

		const con = await db.connect();
		await con.query('LOAD icu; SET TIMEZONE=\'UTC\';');
		return new DuckDBInstance(db, con);
	}

	async runQuery(query: string): Promise<Table<any> | string> {
		try {
			return await this.con.query(query);
		} catch (error) {
			return JSON.stringify(error);
		}
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

function uriToFilePath(uri: string) {
	// On Windows, we need to fix up the path so that it is recognizable as a drive path.
	// Not sure how reliable this is, but it seems to work for now.
	if (process.platform === 'win32') {
		const filePath = path.parse(uri);
		// Example: {
		//    root: '/',
		//    dir: '/c:/Users/sharon/qa-example-content/data-files/flights',
		//    base: 'flights.parquet', ext: '.parquet',
		//    name: 'flights'
		// }
		if (filePath.root === '/' && filePath.dir.startsWith('/')) {
			// Remove the leading slash from the path so the path is drive path
			return uri.substring(1);
		}
	}
	return uri;
}

// TODO
// - Decimal
// - Nested types
// - JSON
const SCHEMA_TYPE_MAPPING = new Map<string, ColumnDisplayType>([
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
	['TIMESTAMP_NS', ColumnDisplayType.Datetime],
	['TIMESTAMP WITH TIME ZONE', ColumnDisplayType.Datetime],
	['TIMESTAMP_NS WITH TIME ZONE', ColumnDisplayType.Datetime],
	['TIME', ColumnDisplayType.Time]
]);

/**
 * Interface for serving data explorer requests for a particular table in DuckDB
 */
export class DuckDBTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];
	private columnFilters: Array<ColumnFilter> = [];

	private _unfilteredShape: Promise<[number, number]>;
	private _filteredShape: Promise<[number, number]>;

	constructor(readonly uri: string, readonly tableName: string,
		readonly fullSchema: Array<SchemaEntry>,
		readonly db: DuckDBInstance
	) {
		this._unfilteredShape = this._getUnfilteredShape();
		this._filteredShape = this._unfilteredShape;
	}

	async getSchema(params: GetSchemaParams): RpcResponse<TableSchema> {
		return {
			columns: params.column_indices.map((index) => {
				const entry = this.fullSchema[index];
				let type_display = SCHEMA_TYPE_MAPPING.get(entry.column_type);
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

	async getDataValues(params: GetDataValuesParams): RpcResponse<TableData> {
		// Because DuckDB is a SQL engine, we opt to always select a row range of
		// formatted data for a range of rows, and then return the requested selections
		// based on what the UI requested. This blunt approach could end up being wasteful in
		// some cases, but doing fewer queries / scans in the average case should yield better
		// performance.
		let lowerLimit = Infinity;
		let upperLimit = -Infinity;

		const smallNumDigits = params.format_options.small_num_digits;
		const largeNumDigits = params.format_options.large_num_digits;
		const thousandsSep = params.format_options.thousands_sep;
		const sciNotationLimit = '1' + '0'.repeat(params.format_options.max_integral_digits);
		const scientificFormat = `%.${largeNumDigits}e`;
		const varcharLimit = params.format_options.max_value_length;

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

			const columnSchema = this.fullSchema[column.column_index];
			const quotedName = `"${columnSchema.column_name}"`;

			// TODO: what is column_index is out of bounds?

			// Build column selector. Just casting to string for now
			let columnSelector;
			switch (columnSchema.column_type) {
				case 'FLOAT':
				case 'DOUBLE': {
					let largeFormatter, smallFormatter;
					if (thousandsSep !== undefined) {
						largeFormatter = `FORMAT('%,.${largeNumDigits}f', ${quotedName})`;
						smallFormatter = `FORMAT('%,.${smallNumDigits}f', ${quotedName})`;
						if (thousandsSep !== ',') {
							largeFormatter = `REPLACE(${largeFormatter}, ',', '${thousandsSep}')`;
							smallFormatter = `REPLACE(${smallFormatter}, ',', '${thousandsSep}')`;
						}
					} else {
						largeFormatter = `FORMAT('%.${largeNumDigits}f', ${quotedName})`;
						smallFormatter = `FORMAT('%.${smallNumDigits}f', ${quotedName})`;
					}
					columnSelector = `CASE WHEN ${quotedName} IS NULL THEN 'NULL'
WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
WHEN isinf(${quotedName}) AND value < 0 THEN '-Inf'
WHEN isnan(${quotedName}) THEN 'NaN'
WHEN abs(${quotedName}) >= ${sciNotationLimit} THEN FORMAT(${scientificFormat}, ${quotedName})
WHEN abs(${quotedName}) < 1 THEN ${smallFormatter}
ELSE ${largeFormatter}
END`;
					break;
				}
				case 'VARCHAR':
					columnSelector = `SUBSTRING(${quotedName}, 1, ${varcharLimit})`;
					break;
				case 'TIMESTAMP':
					columnSelector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
					break;
				default:
					columnSelector = `CAST(${quotedName} AS VARCHAR)`;
					break;
			}
			columnSelectors.push(`${columnSelector} AS formatted_${columnSelectors.length} `);
		}

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
		FROM ${this.tableName}
		LIMIT ${numRows}
		OFFSET ${lowerLimit} `;

		const queryResult = await this.db.runQuery(query);
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

	async getRowLabels(params: GetRowLabelsParams): RpcResponse<TableRowLabels> {
		return 'not implemented';
	}

	async getState(): RpcResponse<BackendState> {
		const [unfiltedNumRows, unfilteredNumCols] = await this._unfilteredShape;
		const [filteredNumRows, filteredNumCols] = await this._filteredShape;
		return {
			display_name: path.basename(this.uri),
			table_shape: {
				num_rows: filteredNumRows,
				num_columns: filteredNumCols
			},
			table_unfiltered_shape: {
				num_rows: unfiltedNumRows,
				num_columns: unfilteredNumCols
			},
			has_row_labels: false,
			column_filters: this.columnFilters,
			row_filters: this.rowFilters,
			sort_keys: this.sortKeys,
			supported_features: {
				get_column_profiles: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{
							profile_type: ColumnProfileType.NullCount,
							support_status: SupportStatus.Supported
						}
					]
				},
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
				set_sort_columns: { support_status: SupportStatus.Unsupported, },
				export_data_selection: {
					support_status: SupportStatus.Unsupported,
					supported_formats: []
				}
			}
		};
	}

	async getColumnProfiles(params: GetColumnProfilesParams): RpcResponse<void> {
		// Initiate but do not await profile evaluations
		this._evaluateColumnProfiles(params);
	}

	private async _evaluateColumnProfiles(params: GetColumnProfilesParams) {
		const profileExprs: Array<string> = [];
		const queryResultIds: Array<Array<number | undefined>> = [];

		let resultIndex = 0;
		for (const request of params.profiles) {
			const columnSchema = this.fullSchema[request.column_index];
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
				profileExprs.push(`${profileExpr} AS profile_${resultIndex} `);
				resultIds.push(resultIndex++);
			});
			queryResultIds.push(resultIds);
		}

		let result;
		if (profileExprs.length > 0) {
			const profileQuery = `
			SELECT ${profileExprs.join(',\n    ')}
			FROM ${this.tableName} `;
			result = await this.db.runQuery(profileQuery);
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
				uri: this.uri,
				method: DataExplorerFrontendEvent.ReturnColumnProfiles,
				params: response
			} satisfies DataExplorerUiEvent
		);
	}

	async setRowFilters(params: SetRowFiltersParams): RpcResponse<FilterResult> {
		return 'not implemented';
	}

	async setSortColumns(params: SetSortColumnsParams): RpcResponse<void> {
		return 'not implemented';
	}

	async exportDataSelection(params: ExportDataSelectionParams): RpcResponse<ExportedData> {
		return 'not implemented';
	}

	private async _getUnfilteredShape(): Promise<[number, number]> {
		const numColumns = this.fullSchema.length;
		const countStar = `SELECT count(*) AS num_rows FROM ${this.tableName} `;

		const result = await this.db.runQuery(countStar);

		let numRows: number;
		if (typeof result === 'string') {
			numRows = 0;
		} else {
			// The count comes back as BigInt
			numRows = Number(result.toArray()[0].num_rows);
		}
		return [numRows, numColumns];
	}
}

/**
 * Implementation of Data Explorer backend protocol using duckdb-wasm,
 * for serving requests coming in through the vscode command.
 */
export class DataExplorerRpcHandler {
	private readonly _uriToTableView = new Map<string, DuckDBTableView>();
	private _tableIndex: number = 0;

	constructor(private readonly db: DuckDBInstance) { }

	async openDataset(params: OpenDatasetParams): Promise<OpenDatasetResult> {
		const tableName = `positron_${this._tableIndex++}`;

		const filePath = uriToFilePath(params.uri);
		const fileExt = path.extname(filePath);

		let scanOperation;
		switch (fileExt) {
			case '.parquet':
			case '.parq':
				scanOperation = `parquet_scan('${filePath}')`;
				break;
			// TODO: Will need to be able to pass CSV / TSV options from the
			// UI at some point.
			case '.csv':
				scanOperation = `read_csv('${filePath}')`;
				break;
			case '.tsv':
				scanOperation = `read_csv('${filePath}', delim='\t')`;
				break;
			default:
				return { error_message: `Unsupported file extension: ${fileExt}` };
		}

		const ctasQuery = `
		CREATE TABLE ${tableName} AS
		SELECT * FROM ${scanOperation}`;

		let result = await this.db.runQuery(ctasQuery);
		if (typeof result === 'string') {
			return { error_message: result };
		}

		const schemaQuery = `DESCRIBE ${tableName};`;
		result = await this.db.runQuery(schemaQuery);
		if (typeof result === 'string') {
			return { error_message: result };
		}

		const tableView = new DuckDBTableView(params.uri, tableName, result.toArray(), this.db);
		this._uriToTableView.set(params.uri, tableView);

		return {};
	}

	async createTableFromSQL(createQuery: string) {

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
		const table = this._uriToTableView.get(rpc.uri) as DuckDBTableView;
		switch (rpc.method) {
			case DataExplorerBackendRequest.ExportDataSelection:
				return table.exportDataSelection(rpc.params as ExportDataSelectionParams);
			case DataExplorerBackendRequest.GetColumnProfiles:
				return table.getColumnProfiles(rpc.params as GetColumnProfilesParams);
			case DataExplorerBackendRequest.GetDataValues:
				return table.getDataValues(rpc.params as GetDataValuesParams);
			case DataExplorerBackendRequest.GetRowLabels:
				return table.getRowLabels(rpc.params as GetRowLabelsParams);
			case DataExplorerBackendRequest.GetSchema:
				return table.getSchema(rpc.params as GetSchemaParams);
			case DataExplorerBackendRequest.GetState:
				return table.getState();
			case DataExplorerBackendRequest.SetRowFilters:
				return table.setRowFilters(rpc.params as SetRowFiltersParams);
			case DataExplorerBackendRequest.SetSortColumns:
				return table.setSortColumns(rpc.params as SetSortColumnsParams);
			case DataExplorerBackendRequest.SetColumnFilters:
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
				const result = await db.runQuery(query);
				if (typeof result === 'string') {
					console.error('DuckDB error:', result);
				} else {
					return result.toArray();
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
