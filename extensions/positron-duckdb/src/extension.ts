/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import {
	ArraySelection,
	BackendState,
	CodeSyntaxName,
	ColumnDisplayType,
	ColumnFilter,
	ColumnFilterType,
	ColumnFrequencyTable,
	ColumnFrequencyTableParams,
	ColumnHistogram,
	ColumnHistogramParams,
	ColumnHistogramParamsMethod,
	ColumnProfileRequest,
	ColumnProfileResult,
	ColumnProfileType,
	ColumnSchema,
	ColumnSortKey,
	ColumnSummaryStats,
	ColumnValue,
	ConvertedCode,
	ConvertToCodeParams,
	DataExplorerBackendRequest,
	DataExplorerFrontendEvent,
	DataExplorerResponse,
	DataExplorerRpc,
	DataExplorerUiEvent,
	DataSelectionCellRange,
	DataSelectionCellIndices,
	DataSelectionIndices,
	DataSelectionRange,
	DataSelectionSingleCell,
	DatasetImportOptions,
	ExportDataSelectionParams,
	ExportedData,
	ExportFormat,
	FilterBetween,
	FilterComparison,
	FilterComparisonOp,
	FilterMatchDataTypes,
	FilterResult,
	FilterSetMembership,
	FilterTextSearch,
	GetColumnProfilesParams,
	GetDataValuesParams,
	GetRowLabelsParams,
	GetSchemaParams,
	OpenDatasetParams,
	OpenDatasetResult,
	ReturnColumnProfilesEvent,
	RowFilter,
	RowFilterType,
	SearchSchemaParams,
	SearchSchemaResult,
	SearchSchemaSortOrder,
	SetDatasetImportOptionsParams,
	SetDatasetImportOptionsResult,
	SetRowFiltersParams,
	SetSortColumnsParams,
	SupportStatus,
	TableData,
	TableRowLabels,
	TableSchema,
	TableSelectionKind,
	TextSearchType
} from 'positron-data-explorer-protocol';

/**
 * Type guard to check if an ArraySelection is a DataSelectionRange (has first_index/last_index).
 */
function isSelectionRange(spec: ArraySelection): spec is DataSelectionRange {
	return (spec as DataSelectionRange).first_index !== undefined;
}
import { ChildProcess, fork } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as yauzl from 'yauzl';
import { WorkerQueryRequest, WorkerQueryResponse } from './duckdbWorkerProtocol';
import { createWorkerEnv } from './workerEnv.js';

// Set to true when doing development for better console logging
const DEBUG_LOG = false;

/** Logs a prefixed message to the console when {@link DEBUG_LOG} is enabled. */
function debugLog(message: string): void {
	if (DEBUG_LOG) {
		console.log(`[positron-duckdb] ${message}`);
	}
}

/**
 * A query result materialized in the DuckDB worker and reconstructed here from
 * the column-oriented form that crosses the IPC boundary. Exposes the small set
 * of shapes the rest of the extension relies on.
 */
class QueryResult {
	private _rows: any[] | undefined;

	constructor(
		private readonly _columnNames: string[],
		// One array of values per column, in column order.
		private readonly _columns: any[][]
	) { }

	/** The number of columns in the result. */
	get numCols(): number {
		return this._columns.length;
	}

	/** The number of rows in the (materialized) result. */
	get numRows(): number {
		return this._columns.length > 0 ? this._columns[0].length : 0;
	}

	/** The names of the columns, in column order. */
	get columnNames(): string[] {
		return this._columnNames;
	}

	// Note: values are already coerced to plain JS in the worker (Date for
	// temporal types, number for DECIMAL, bigint for integers, etc.), so values
	// that aren't explicitly CAST to VARCHAR in SQL still render and serialize
	// sanely. Integer types remain bigint; count/stat call sites wrap those in
	// Number(...).

	/** The result rows as plain objects keyed by column name. */
	toArray(): any[] {
		if (this._rows === undefined) {
			const numRows = this.numRows;
			const rows: any[] = new Array(numRows);
			for (let r = 0; r < numRows; r++) {
				const row: { [name: string]: any } = {};
				for (let c = 0; c < this._columnNames.length; c++) {
					row[this._columnNames[c]] = this._columns[c][r];
				}
				rows[r] = row;
			}
			this._rows = rows;
		}
		return this._rows;
	}

	/** The values for the column at the given index. */
	columnAt(index: number): any[] {
		return this._columns[index];
	}

	/** The values for the column with the given name. */
	columnByName(name: string): any[] {
		return this.columnAt(this._columnNames.indexOf(name));
	}
}

/**
 * Host-side proxy for DuckDB. The native database runs in a separate child
 * process (`duckdbWorker.ts`); this class forks it, forwards queries over IPC,
 * and reconstructs results. Isolating the native binding means a query that
 * exhausts memory aborts only the child: a native abort cannot be caught
 * in-process, so the child dying is the only thing that keeps the extension
 * host alive. When the worker dies, in-flight queries reject with a clear
 * error, `onDidCrash` fires, and the next query transparently respawns it.
 */
export class DuckDBInstance {
	/** Resolved path to the bundled worker entry, emitted next to this module. */
	private static readonly defaultWorkerPath = path.join(__dirname, 'duckdbWorker.js');

	/**
	 * How long the worker lingers after the last data explorer closes before it
	 * self-terminates to reclaim memory. The native DuckDB child holds tens of
	 * megabytes, so we don't want it resident once nothing is using it; the next
	 * query respawns it transparently (see {@link runQuery}).
	 */
	private static readonly IDLE_SHUTDOWN_MS = 120_000;

	private _worker: ChildProcess | undefined;
	private _nextId = 0;
	private readonly _pending = new Map<number, { resolve: (result: QueryResult) => void; reject: (error: Error) => void }>();
	private _disposed = false;
	private _idleShutdownTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly _onDidCrash = new vscode.EventEmitter<void>();
	/** Fires when the worker process terminates unexpectedly (e.g. out of memory). */
	readonly onDidCrash: vscode.Event<void> = this._onDidCrash.event;

	private constructor(
		private readonly workerPath: string,
		private readonly idleShutdownMs: number,
	) { }

	/** Whether the worker child process is currently running. Exposed for tests. */
	get isWorkerRunning(): boolean {
		return this._worker !== undefined;
	}

	/**
	 * Create a DuckDB instance. The worker child process is NOT started here: it
	 * spawns lazily on the first query (see {@link runQuery}), so activating the
	 * extension and constructing the instance costs nothing until a dataset is
	 * actually opened.
	 *
	 * `workerPath` overrides the worker entry point and `idleShutdownMs` the
	 * idle-shutdown cooldown; both exist only for tests (to exercise crash recovery
	 * with a stub worker and idle shutdown without a two-minute wait).
	 */
	static async create(
		workerPath: string = DuckDBInstance.defaultWorkerPath,
		idleShutdownMs: number = DuckDBInstance.IDLE_SHUTDOWN_MS,
	): Promise<DuckDBInstance> {
		return new DuckDBInstance(workerPath, idleShutdownMs);
	}

	private spawnWorker(): void {
		// "advanced" serialization uses the V8 structured-clone algorithm, which
		// preserves bigint and Date values returned by DuckDB.
		const worker = fork(this.workerPath, [], {
			serialization: 'advanced',
			execArgv: [],
			env: createWorkerEnv(),
		});
		worker.on('message', (message: unknown) => {
			const response = message as WorkerQueryResponse;
			const pending = this._pending.get(response.id);
			if (!pending) {
				return;
			}
			this._pending.delete(response.id);
			if (response.kind === 'result') {
				pending.resolve(new QueryResult(response.columnNames, response.columns));
			} else {
				pending.reject(new Error(response.error));
			}
		});
		worker.on('exit', (code, signal) => this.onWorkerGone(worker, `exited (code=${code}, signal=${signal})`));
		worker.on('error', (error) => this.onWorkerGone(worker, `failed to start: ${error.message}`));
		this._worker = worker;
		debugLog(`Spawned worker process (pid=${worker.pid})`);
	}

	/**
	 * Handle the worker process going away. Reject every in-flight query so
	 * callers fail gracefully rather than hanging, and notify listeners. The
	 * worker is respawned lazily on the next query.
	 *
	 * `worker` is the process the handler was bound to. A worker we deliberately
	 * killed (idle shutdown, {@link close}) exits asynchronously, by which point a
	 * new worker may already be current; ignoring events from anything but the
	 * current worker keeps a stale exit from rejecting queries on its replacement.
	 */
	private onWorkerGone(worker: ChildProcess, detail: string): void {
		if (this._worker !== worker) {
			// A worker we already replaced or intentionally killed (idle shutdown,
			// close), or a duplicate event (both 'error' and 'exit' fired).
			return;
		}
		this._worker = undefined;
		debugLog(`Worker process terminated unexpectedly: ${detail}`);

		const reason = new Error(`The DuckDB process terminated unexpectedly (${detail}). This usually means a query exhausted available memory.`);
		for (const pending of this._pending.values()) {
			pending.reject(reason);
		}
		this._pending.clear();

		if (!this._disposed) {
			this._onDidCrash.fire();
		}
	}

	/** Closes the worker process and rejects any in-flight queries. */
	close(): void {
		this._disposed = true;
		this.cancelIdleShutdown();
		const worker = this._worker;
		this._worker = undefined;
		if (worker !== undefined) {
			debugLog(`Disposing instance; killing worker process (pid=${worker.pid})`);
		}
		worker?.kill();
		for (const pending of this._pending.values()) {
			pending.reject(new Error('The DuckDB instance was disposed.'));
		}
		this._pending.clear();
		this._onDidCrash.dispose();
	}

	/**
	 * Arm the idle-shutdown timer. Called when the last data explorer closes: after
	 * {@link IDLE_SHUTDOWN_MS} with no client, the worker self-terminates to free its
	 * native memory. A no-op if already armed, disposed, or the worker isn't running.
	 */
	requestIdleShutdown(): void {
		if (this._disposed || this._idleShutdownTimer !== undefined || this._worker === undefined) {
			return;
		}
		this._idleShutdownTimer = setTimeout(() => {
			this._idleShutdownTimer = undefined;
			this.shutdownIdleWorker();
		}, this.idleShutdownMs);
		debugLog(`No clients remain; arming idle shutdown in ${this.idleShutdownMs}ms`);
	}

	/** Cancel a pending idle shutdown, e.g. when a data explorer is (re)opened. */
	cancelIdleShutdown(): void {
		if (this._idleShutdownTimer !== undefined) {
			clearTimeout(this._idleShutdownTimer);
			this._idleShutdownTimer = undefined;
			debugLog('Cancelled pending idle shutdown');
		}
	}

	/**
	 * Terminate the idle worker. Nulling `_worker` before killing means the 'exit'
	 * handler treats this as an expected shutdown (not a crash), so `onDidCrash`
	 * does not fire. If a query happens to be in flight, reschedule rather than
	 * interrupt it.
	 */
	private shutdownIdleWorker(): void {
		if (this._disposed || this._worker === undefined) {
			return;
		}
		if (this._pending.size > 0) {
			this.requestIdleShutdown();
			return;
		}
		const worker = this._worker;
		this._worker = undefined;
		debugLog(`Idle cooldown elapsed; killing worker process (pid=${worker.pid})`);
		worker.kill();
	}

	runQuery(query: string): Promise<QueryResult> {
		if (this._disposed) {
			return Promise.reject(new Error('The DuckDB instance was disposed.'));
		}
		// A query means the instance is in use; don't let it be reaped mid-flight.
		this.cancelIdleShutdown();
		// Lazily (re)spawn the worker, e.g. on the first query or after a crash or
		// idle shutdown.
		if (this._worker === undefined) {
			this.spawnWorker();
		}

		const id = this._nextId++;
		const request: WorkerQueryRequest = { id, sql: query };
		return new Promise<QueryResult>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			if (DEBUG_LOG) {
				console.log(`Running query ${id}:\n${query}`);
			}
			this._worker!.send(request);
		});
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
const SENTINEL_NEGINF = 11;

// TODO
// - Nested types
// - JSON
const SCHEMA_TYPE_MAPPING = new Map<string, ColumnDisplayType>([
	['BOOLEAN', ColumnDisplayType.Boolean],
	['UTINYINT', ColumnDisplayType.Integer],
	['TINYINT', ColumnDisplayType.Integer],
	['USMALLINT', ColumnDisplayType.Integer],
	['SMALLINT', ColumnDisplayType.Integer],
	['UINTEGER', ColumnDisplayType.Integer],
	['INTEGER', ColumnDisplayType.Integer],
	['UBIGINT', ColumnDisplayType.Integer],
	['BIGINT', ColumnDisplayType.Integer],
	['FLOAT', ColumnDisplayType.Floating],
	['DOUBLE', ColumnDisplayType.Floating],
	['VARCHAR', ColumnDisplayType.String],
	['UUID', ColumnDisplayType.String],
	['DATE', ColumnDisplayType.Date],
	['TIMESTAMP', ColumnDisplayType.Datetime],
	['TIMESTAMP_NS', ColumnDisplayType.Datetime],
	['TIMESTAMP WITH TIME ZONE', ColumnDisplayType.Datetime],
	['TIMESTAMP_NS WITH TIME ZONE', ColumnDisplayType.Datetime],
	['TIME', ColumnDisplayType.Time],
	['INTERVAL', ColumnDisplayType.Interval],
	['DECIMAL', ColumnDisplayType.Decimal]
]);

function formatLiteral(value: string, schema: ColumnSchema) {
	if (schema.type_display === ColumnDisplayType.String) {
		return `'${value}'`;
	} else {
		return value;
	}
}

const COMPARISON_OPS = new Map<FilterComparisonOp, string>([
	[FilterComparisonOp.Eq, '='],
	[FilterComparisonOp.NotEq, '<>'],
	[FilterComparisonOp.Gt, '>'],
	[FilterComparisonOp.GtEq, '>='],
	[FilterComparisonOp.Lt, '<'],
	[FilterComparisonOp.LtEq, '<=']
]);

function makeWhereExpr(rowFilter: RowFilter): string {
	const schema = rowFilter.column_schema;
	const quotedName = quoteIdentifier(schema.column_name);
	switch (rowFilter.filter_type) {
		case RowFilterType.Compare: {
			const params = rowFilter.params as FilterComparison;
			const formattedValue = formatLiteral(params.value, schema);
			const op: string = COMPARISON_OPS.get(params.op) ?? params.op;
			return `${quotedName} ${op} ${formattedValue}`;
		}
		case RowFilterType.NotBetween:
		case RowFilterType.Between: {
			const params = rowFilter.params as FilterBetween;
			const left = formatLiteral(params.left_value, schema);
			const right = formatLiteral(params.right_value, schema);
			let expr = `${quotedName} BETWEEN ${left} AND ${right}`;
			if (rowFilter.filter_type === RowFilterType.NotBetween) {
				expr = `(NOT (${expr}))`;
			}
			return expr;
		}
		case RowFilterType.IsEmpty:
			return `${quotedName} = ''`;
		case RowFilterType.NotEmpty:
			return `${quotedName} <> ''`;
		case RowFilterType.IsFalse:
			return `${quotedName} = false`;
		case RowFilterType.IsTrue:
			return `${quotedName} = true`;
		case RowFilterType.IsNull:
			return `${quotedName} IS NULL`;
		case RowFilterType.NotNull:
			return `${quotedName} IS NOT NULL`;
		case RowFilterType.Search: {
			const params = rowFilter.params as FilterTextSearch;
			const searchArg = params.case_sensitive ? quotedName : `lower(${quotedName})`;
			const searchTerm = params.case_sensitive ? `'${params.term}'` : `lower('${params.term}')`;

			switch (params.search_type) {
				case TextSearchType.Contains:
					return `${searchArg} LIKE '%' || ${searchTerm} || '%'`;
				case TextSearchType.NotContains:
					return `${searchArg} NOT LIKE '%' || ${searchTerm} || '%'`;
				case TextSearchType.StartsWith:
					return `${searchArg} LIKE ${searchTerm} || '%'`;
				case TextSearchType.EndsWith:
					return `${searchArg} LIKE '%' || ${searchTerm}`;
				case TextSearchType.RegexMatch: {
					const options = params.case_sensitive ? ', \'i\'' : '';
					return `regexp_matches(${searchArg}, \'${params.term}\'${options})`;
				}
			}
		}
		case RowFilterType.SetMembership: {
			const params = rowFilter.params as FilterSetMembership;
			const op = params.inclusive ? 'IN' : 'NOT IN';
			const valuesLiteral = '[' + params.values.map((x) => formatLiteral(x, schema)).join(', ') + ']';
			return `${quotedName} ${op} ${valuesLiteral}`;
		}
	}
}

/**
 * Properly quotes and escapes an identifier for use in DuckDB SQL.
 * Handles field names containing quotes by doubling them (DuckDB's escaping convention).
 * @param fieldName The field name to quote
 * @returns The properly quoted and escaped identifier
 */
function quoteIdentifier(fieldName: string) {
	// Double any existing double quotes and wrap in double quotes
	return '"' + fieldName.replace(/"/g, '""') + '"';
}

/**
 * Escapes a string for use inside a single-quoted DuckDB SQL string literal,
 * e.g. a file path passed to read_csv_auto or parquet_scan.
 * @param value The raw string value (the caller supplies the surrounding quotes)
 * @returns The value with single quotes doubled per SQL escaping convention
 */
function quoteLiteral(value: string) {
	return value.replace(/'/g, '\'\'');
}

/**
 * Decompresses a gzip- or zstd-compressed buffer. Used for Parquet files, whose
 * reader cannot unwrap an outer compression container the way DuckDB's CSV/TSV
 * readers can.
 * @param data The compressed bytes
 * @param compression The compression scheme
 * @returns The decompressed bytes
 */
function decompress(data: Uint8Array, compression: 'gzip' | 'zstd'): Uint8Array {
	if (compression === 'gzip') {
		return zlib.gunzipSync(data);
	}
	// zstdDecompressSync was added to Node's zlib after the @types/node version
	// pinned here, so reach for it through a narrowed type.
	const zstd = (zlib as typeof zlib & {
		zstdDecompressSync?: (buf: Uint8Array) => Buffer;
	}).zstdDecompressSync;
	if (typeof zstd !== 'function') {
		throw new Error('Zstandard decompression is not supported by this runtime');
	}
	return zstd(data);
}

/**
 * Directory holding the vendored DuckDB `excel` extension. `__dirname` is the
 * compiled output directory (e.g. `out/`), which sits one level below the
 * extension root alongside `resources/`.
 */
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

/**
 * Absolute path to the bundled DuckDB `excel` extension. It is vendored under
 * `resources/` for the platform this build targets by the `install-excel-extension`
 * postinstall step. Reading `.xlsx` files requires this extension; we load it from
 * disk so the feature works offline / airgapped rather than relying on DuckDB's
 * network autoload.
 */
const EXCEL_EXTENSION_PATH = path.join(RESOURCES_DIR, 'excel.duckdb_extension');

/**
 * macOS only: DuckDB's trailing footer, stripped from `EXCEL_EXTENSION_PATH` at
 * install time so the Mach-O could be Apple-signed (see
 * scripts/install-excel-extension.ts). Re-attached at runtime by
 * `resolveExcelExtensionPath`.
 */
const EXCEL_EXTENSION_FOOTER_PATH = path.join(RESOURCES_DIR, 'excel.duckdb_extension.footer');

/** Records the bundled extension's version (e.g. `v1.5.3/osx_arm64`). */
const EXCEL_VERSION_PATH = path.join(RESOURCES_DIR, 'EXCEL_VERSION');

/**
 * Resolve a filesystem path to a loadable `excel` extension, reconstructing it
 * first if necessary.
 *
 * On macOS the bundled extension ships with DuckDB's trailing footer stripped --
 * so the Mach-O can be Apple-signed without tripping codesign's strict validation
 * -- and the footer saved alongside it (see scripts/install-excel-extension.ts).
 * DuckDB needs that footer to recognize and load the extension, but the signed app
 * bundle is read-only and sealed: re-attaching the footer in place would
 * invalidate the app signature. So we reconstruct the full extension once into a
 * writable cache directory outside the bundle and load it from there. On other
 * platforms the bundled extension is complete and loaded in place.
 *
 * @param storageDir A writable directory (the extension's global storage) used to
 *   cache the reconstructed extension on macOS.
 */
function resolveExcelExtensionPath(storageDir: string): string {
	// Only macOS strips the footer; elsewhere the bundled file is complete. Also
	// fall back to the bundled file if there's no footer to re-attach (e.g. a dev
	// build where stripping was skipped).
	if (process.platform !== 'darwin' || !fs.existsSync(EXCEL_EXTENSION_FOOTER_PATH)) {
		return EXCEL_EXTENSION_PATH;
	}

	const version = fs.existsSync(EXCEL_VERSION_PATH)
		? fs.readFileSync(EXCEL_VERSION_PATH, 'utf-8').trim()
		: 'unknown';
	// DuckDB derives the extension's entrypoint from the file's basename (the part
	// before `.duckdb_extension`), so the reconstructed file MUST keep the name
	// `excel.duckdb_extension`. Version the containing directory instead, so a
	// build update lands in a fresh location.
	const cacheDir = path.join(storageDir, `excel-${version.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
	const target = path.join(cacheDir, 'excel.duckdb_extension');

	const expectedSize = fs.statSync(EXCEL_EXTENSION_PATH).size + fs.statSync(EXCEL_EXTENSION_FOOTER_PATH).size;
	// Reuse a previously reconstructed file if it's intact (right total size).
	if (fs.existsSync(target) && fs.statSync(target).size === expectedSize) {
		return target;
	}

	fs.mkdirSync(cacheDir, { recursive: true });
	const reconstructed = Buffer.concat([
		fs.readFileSync(EXCEL_EXTENSION_PATH),
		fs.readFileSync(EXCEL_EXTENSION_FOOTER_PATH),
	]);
	// Write to a temp file then rename so a partial write never leaves a corrupt
	// extension at the target path.
	const tmp = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, new Uint8Array(reconstructed));
	fs.renameSync(tmp, target);
	return target;
}

/**
 * Read a single entry from a `.zip`/`.xlsx` archive as UTF-8 text. Resolves to
 * `undefined` if the archive or entry cannot be read. When `maxBytes` is given,
 * reading stops once that many bytes have been buffered -- enough for callers
 * that only need an element near the head of an otherwise large part (e.g. a
 * worksheet's `<dimension>`, which precedes the bulk `<sheetData>`).
 * @param filePath Path to the archive on disk.
 * @param entryName The exact archive-relative entry name to read.
 * @param maxBytes Optional cap on how many bytes to buffer before stopping.
 * @returns The entry's text, or undefined if it could not be read.
 */
function readZipEntryText(filePath: string, entryName: string, maxBytes?: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) {
				resolve(undefined);
				return;
			}
			let settled = false;
			const finish = (value: string | undefined) => {
				if (!settled) {
					settled = true;
					resolve(value);
				}
				zipfile.close();
			};
			zipfile.on('entry', (entry) => {
				if (entry.fileName !== entryName) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr || !stream) {
						finish(undefined);
						return;
					}
					const chunks: Buffer[] = [];
					let total = 0;
					const done = () => finish(Buffer.concat(chunks).toString('utf8'));
					stream.on('data', (chunk: Buffer) => {
						chunks.push(chunk);
						total += chunk.length;
						if (maxBytes !== undefined && total >= maxBytes) {
							// Enough for the caller; stop early. 'close' resolves below.
							stream.destroy();
						}
					});
					stream.on('error', () => finish(undefined));
					stream.on('end', done);
					stream.on('close', done);
				});
			});
			// Reached the end of the archive without finding the entry.
			zipfile.on('end', () => finish(undefined));
			zipfile.on('error', () => finish(undefined));
			zipfile.readEntry();
		});
	});
}

/**
 * Read the worksheet names from an `.xlsx` workbook, in workbook order.
 *
 * An `.xlsx` file is a ZIP archive whose sheet names live in the small, stable
 * `xl/workbook.xml` entry. We read just that entry rather than depending on a
 * full spreadsheet parser. Resolves to `undefined` if the names cannot be
 * determined (e.g. the archive is unreadable); callers fall back to opening the
 * default sheet rather than failing the whole import.
 * @param filePath Path to the .xlsx file on disk.
 * @returns The sheet names, or undefined if they could not be read.
 */
async function readXlsxSheetNames(filePath: string): Promise<string[] | undefined> {
	const workbookXml = await readZipEntryText(filePath, 'xl/workbook.xml');
	return workbookXml === undefined ? undefined : parseSheetNames(workbookXml);
}

/**
 * Read the declared used-cell range (the `ref` of a worksheet's `<dimension>`
 * element) for a sheet in an `.xlsx` workbook, e.g. `"A2:W65"`.
 *
 * `<dimension>` is an *advisory* hint in the OOXML format -- writers may omit
 * it or leave it stale -- so callers must treat it only as a recovery aid, never
 * as the authoritative range. Resolves to `undefined` if it cannot be
 * determined.
 * @param filePath Path to the .xlsx file on disk.
 * @param sheetName The worksheet to read; defaults to the first sheet in the
 * workbook when omitted.
 * @returns The dimension ref string, or undefined if it could not be read.
 */
async function readXlsxSheetDimension(filePath: string, sheetName?: string): Promise<string | undefined> {
	const workbookXml = await readZipEntryText(filePath, 'xl/workbook.xml');
	if (workbookXml === undefined) {
		return undefined;
	}

	// Map each <sheet> to its relationship id, in workbook order. Attribute order
	// is not guaranteed, so pull `name` and `r:id` out of each element separately.
	const sheets: Array<{ name: string; rId: string }> = [];
	const sheetRegex = /<sheet\b[^>]*?>/g;
	let sheetMatch: RegExpExecArray | null;
	while ((sheetMatch = sheetRegex.exec(workbookXml)) !== null) {
		const tag = sheetMatch[0];
		const name = /\bname="([^"]*)"/.exec(tag)?.[1];
		const rId = /\br:id="([^"]*)"/.exec(tag)?.[1];
		if (name !== undefined && rId !== undefined) {
			sheets.push({ name: decodeXmlEntities(name), rId });
		}
	}
	const target = sheetName !== undefined
		? sheets.find(sheet => sheet.name === sheetName)
		: sheets[0];
	if (target === undefined) {
		return undefined;
	}

	// Resolve the relationship id to the worksheet part path.
	const relsXml = await readZipEntryText(filePath, 'xl/_rels/workbook.xml.rels');
	if (relsXml === undefined) {
		return undefined;
	}
	let worksheetEntry: string | undefined;
	const relRegex = /<Relationship\b[^>]*?>/g;
	let relMatch: RegExpExecArray | null;
	while ((relMatch = relRegex.exec(relsXml)) !== null) {
		const tag = relMatch[0];
		if (/\bId="([^"]*)"/.exec(tag)?.[1] !== target.rId) {
			continue;
		}
		const rawTarget = /\bTarget="([^"]*)"/.exec(tag)?.[1];
		if (rawTarget !== undefined) {
			const decoded = decodeXmlEntities(rawTarget);
			// Targets are usually relative to xl/; an absolute target (leading
			// slash) is rooted at the package.
			worksheetEntry = decoded.startsWith('/')
				? decoded.slice(1)
				: decoded.startsWith('xl/') ? decoded : `xl/${decoded}`;
		}
		break;
	}
	if (worksheetEntry === undefined) {
		return undefined;
	}

	// <dimension> precedes the bulk <sheetData>, so the head of the part is enough.
	const head = await readZipEntryText(filePath, worksheetEntry, 64 * 1024);
	if (head === undefined) {
		return undefined;
	}
	return /<dimension\b[^>]*\bref="([^"]*)"/.exec(head)?.[1];
}

/**
 * Parse an `.xlsx` cell-range reference (e.g. `"A2:W65"`, or a single cell
 * `"A1"`) into its width and height in cells. Returns `undefined` for a ref that
 * cannot be parsed.
 * @param ref The range reference string.
 * @returns The range's width and height, or undefined if unparseable.
 */
function parseXlsxRange(ref: string): { width: number; height: number } | undefined {
	const match = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(ref.trim());
	if (!match) {
		return undefined;
	}
	const columnToIndex = (letters: string): number => {
		let index = 0;
		for (const ch of letters.toUpperCase()) {
			index = index * 26 + (ch.charCodeAt(0) - 64);
		}
		return index;
	};
	const startCol = columnToIndex(match[1]);
	const startRow = parseInt(match[2], 10);
	const endCol = match[3] ? columnToIndex(match[3]) : startCol;
	const endRow = match[4] ? parseInt(match[4], 10) : startRow;
	return {
		width: Math.abs(endCol - startCol) + 1,
		height: Math.abs(endRow - startRow) + 1
	};
}

/**
 * Extract sheet names from the contents of an `xl/workbook.xml` entry. The
 * `<sheet>` elements are flat (attributes only), so a targeted scan over the
 * `name` attribute is sufficient and avoids a full XML-parser dependency.
 * @param workbookXml The UTF-8 contents of xl/workbook.xml.
 * @returns The decoded sheet names, in document order.
 */
export function parseSheetNames(workbookXml: string): string[] {
	const names: string[] = [];
	const regex = /<sheet\b[^>]*\bname="([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(workbookXml)) !== null) {
		names.push(decodeXmlEntities(match[1]));
	}
	return names;
}

/** Decode the five predefined XML entities. `&amp;` is decoded last so that an
 * encoded entity such as `&amp;lt;` round-trips to `&lt;` rather than `<`. */
function decodeXmlEntities(text: string): string {
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, '\'')
		.replace(/&amp;/g, '&');
}

/**
 * Translate a raw error thrown while reading an `.xlsx` file into a message
 * suitable for display in the data explorer. The data explorer surfaces this
 * text verbatim when an import fails, so it must read as a complete sentence
 * rather than a raw DuckDB diagnostic.
 * @param error The error thrown by the read query.
 * @param uri The URI of the workbook being read.
 * @param sheetName The sheet that was requested, if any.
 * @param availableSheets The sheet names known for the workbook, if any.
 * @returns An Error with a user-facing message.
 */
function translateXlsxError(
	error: unknown,
	uri: vscode.Uri,
	sheetName: string | undefined,
	availableSheets: string[] | undefined
): Error {
	const raw = error instanceof Error ? error.message : String(error);
	const fileName = path.basename(uri.path);

	// A requested sheet that isn't in the workbook. DuckDB reports e.g.
	// 'Binder Error: Sheet "X" not found in xlsx file "..."'.
	if (sheetName && /sheet\b.*\bnot found/i.test(raw)) {
		const sheets = availableSheets?.length
			? availableSheets.join(', ')
			: 'none could be read';
		return new Error(
			`The sheet "${sheetName}" was not found in "${fileName}". Available sheets: ${sheets}.`
		);
	}

	// Anything else (corrupt archive, unsupported feature, unreadable file).
	// Keep the raw diagnostic in the log for debugging, but show a plain message.
	console.error(`Failed to read xlsx "${uri.toString()}": ${raw}`);
	return new Error(
		`Could not read "${fileName}". The file may be corrupt or use an unsupported Excel feature.`
	);
}

function anyValue(unquotedName: string) {
	return `ANY_VALUE(${quoteIdentifier(unquotedName)})`;
}

function alias(expr: string, aliasName: string) {
	return `${expr} AS ${quoteIdentifier(aliasName)}`;
}

/**
 * Generates a safe column name for statistics based on a base field name and statistic type.
 * The returned name is safe to use in SQL and can be used to look up the value in the results.
 * Uses a hash of the field name to ensure the generated identifier is always valid SQL.
 *
 * @param fieldName The base field name
 * @param statType The type of statistic (e.g., 'mean', 'stdev')
 * @returns A safe column name that can be used in SQL
 */
function statColumnName(fieldName: string, statType: string): string {
	// Generate a simple hash of the field name to create a safe identifier
	let hash = 0;
	for (let i = 0; i < fieldName.length; i++) {
		const char = fieldName.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	// Use absolute value and convert to base36 for shorter representation
	const safeFieldHash = Math.abs(hash).toString(36);
	return `stat_${safeFieldHash}_${statType}`;
}

// This class organizes the business logic for computing the summary statistics to populate
// the summary pane in the data explorer. Initially, I tried to compute everything in
// one big SQL query (which requires a bunch of CTEs to compute histogram bin widths, and a CTE
// for each histogram), but the performance was not good. So this first computes the necessary
// summary statistics (min/max, IQR values, null counts), and then we generate further queries
// to compute histograms, etc. with the computations to compute the bin ids, etc. hard coded.
class ColumnProfileEvaluator {
	private selectedFields: Set<string> = new Set();

	private statsExprs: Set<string> = new Set([alias('COUNT(*)', 'num_rows')]);

	constructor(
		private readonly db: DuckDBInstance,
		private readonly fullSchema: Array<SchemaEntry>,
		private readonly tableName: string,
		private readonly whereClause: string,
		private readonly params: GetColumnProfilesParams
	) { }

	private collectStats(i: number, request: ColumnProfileRequest) {
		const columnSchema = this.fullSchema[request.column_index];
		const fieldName = columnSchema.column_name;
		this.selectedFields.add(quoteIdentifier(fieldName));

		for (const spec of request.profiles) {
			switch (spec.profile_type) {
				case ColumnProfileType.NullCount:
					this.addNullCount(fieldName);
					break;
				case ColumnProfileType.LargeHistogram:
				case ColumnProfileType.SmallHistogram:
					this.addNullCount(fieldName);
					this.addHistogramStats(fieldName, spec.params as ColumnHistogramParams);
					break;
				case ColumnProfileType.LargeFrequencyTable:
				case ColumnProfileType.SmallFrequencyTable:
					// Need the null count to compute the size of the "other" group
					this.addNullCount(fieldName);
					break;
				case ColumnProfileType.SummaryStats:
					this.addSummaryStats(columnSchema);
					break;
				default:
					break;
			}
		}
	}

	private addNullCount(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const statName = statColumnName(fieldName, 'null_count');
		this.statsExprs.add(`COUNT(*) - COUNT(${quotedName}) AS ${quoteIdentifier(statName)}`);
	}

	private addMinMax(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const minName = statColumnName(fieldName, 'min');
		const maxName = statColumnName(fieldName, 'max');
		this.statsExprs.add(`MIN(${quotedName}) AS ${quoteIdentifier(minName)}`);
		this.statsExprs.add(`MAX(${quotedName}) AS ${quoteIdentifier(maxName)}`);
	}

	private addMinMaxStringified(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const minName = statColumnName(fieldName, 'string_min');
		const maxName = statColumnName(fieldName, 'string_max');
		this.statsExprs.add(`MIN(${quotedName})::VARCHAR AS ${quoteIdentifier(minName)}`);
		this.statsExprs.add(`MAX(${quotedName})::VARCHAR AS ${quoteIdentifier(maxName)}`);
	}

	private addNumUnique(fieldName: string) {
		const quotedName = quoteIdentifier(fieldName);
		const statName = statColumnName(fieldName, 'nunique');
		this.statsExprs.add(`COUNT(DISTINCT ${quotedName}) AS ${quoteIdentifier(statName)}`);
	}

	private addIqr(fieldName: string) {
		// TODO: This will be imprecise / lossy for out-of-range int64 or decimal values
		const quotedName = quoteIdentifier(fieldName);
		const statName = statColumnName(fieldName, 'iqr');
		this.statsExprs.add(
			`APPROX_QUANTILE(${quotedName}, 0.75)::DOUBLE - APPROX_QUANTILE(${quotedName}, 0.25)::DOUBLE
			AS ${quoteIdentifier(statName)}`
		);
	}

	private addHistogramStats(fieldName: string, params: ColumnHistogramParams) {
		this.addMinMaxStringified(fieldName);
		switch (params.method) {
			case ColumnHistogramParamsMethod.FreedmanDiaconis:
				this.addIqr(fieldName);
				break;
			default:
				// TODO: stats for other methods
				break;
		}
	}

	private addSummaryStats(columnSchema: SchemaEntry) {
		const fieldName = columnSchema.column_name;

		// Quote identifier
		const quotedName = quoteIdentifier(fieldName);
		const getStatName = (statType: string) => statColumnName(fieldName, statType);

		if (isNumeric(columnSchema.column_type)) {
			this.addMinMax(fieldName);
			this.statsExprs.add(`AVG(${quotedName}) AS ${getStatName('mean')}`);
			this.statsExprs.add(`STDDEV_SAMP(${quotedName}) AS ${getStatName('stdev')}`);
			this.statsExprs.add(`MEDIAN(${quotedName}) AS ${getStatName('median')}`);
		} else if (columnSchema.column_type.startsWith('DECIMAL')) {
			this.addMinMaxStringified(fieldName);
			this.statsExprs.add(`AVG(${quotedName})::DOUBLE AS ${getStatName('f64_mean')}`);
			this.statsExprs.add(`STDDEV_SAMP(${quotedName}::DOUBLE) AS ${getStatName('f64_stdev')}`);
			this.statsExprs.add(`MEDIAN(${quotedName}::DOUBLE) AS ${getStatName('f64_median')}`);
		} else if (columnSchema.column_type === 'VARCHAR') {
			this.addNumUnique(fieldName);

			// count strings that are equal to empty string
			this.statsExprs.add(`COUNT(CASE WHEN ${quotedName} = '' THEN 1 END) AS ${getStatName('nempty')}`);
		} else if (columnSchema.column_type === 'BOOLEAN') {
			this.addNullCount(fieldName);
			this.statsExprs.add(`COUNT(CASE WHEN ${quotedName} THEN 1 END) AS ${getStatName('ntrue')}`);
			this.statsExprs.add(`COUNT(CASE WHEN NOT ${quotedName} THEN 1 END) AS ${getStatName('nfalse')}`);
		} else if (columnSchema.column_type === 'TIMESTAMP') {
			this.addMinMaxStringified(fieldName);
			this.addNumUnique(fieldName);
			this.statsExprs.add(`epoch_ms(FLOOR(AVG(epoch_ms(${quotedName})))::BIGINT)::VARCHAR
				AS ${getStatName('string_mean')}`);
			this.statsExprs.add(`epoch_ms(MEDIAN(epoch_ms(${quotedName}))::BIGINT)::VARCHAR
					AS ${getStatName('string_median')}`);
		}
	}

	private async computeFreqTable(columnSchema: SchemaEntry,
		params: ColumnFrequencyTableParams,
		stats: Map<string, any>): Promise<ColumnFrequencyTable> {
		const field = columnSchema.column_name;

		// Quote identifier
		const quotedName = quoteIdentifier(field);

		const predicate = `${quotedName} IS NOT NULL`;
		const composedPred = this.whereClause !== '' ?
			`${this.whereClause} AND ${predicate}` :
			`WHERE ${predicate}`;
		const result = await this.db.runQuery(`
		WITH freq_table AS (
			SELECT ${quotedName} AS value, COUNT(*) AS freq
			FROM ${this.tableName} ${composedPred}
			GROUP BY 1
		)
		SELECT value::VARCHAR AS value, freq
		FROM freq_table
		ORDER BY freq DESC, value ASC
		LIMIT ${params.limit};`);

		const values: string[] = [];
		const counts: number[] = [];

		let total = 0;
		for (const row of result.toArray()) {
			values.push(row.value);

			const valueCount = Number(row.freq);
			counts.push(valueCount);
			total += valueCount;
		}

		const numRows = Number(stats.get('num_rows'));
		const nullCount = Number(stats.get(statColumnName(field, 'null_count')));

		return {
			values,
			counts,
			other_count: numRows - total - nullCount
		};
	}

	private async computeHistogram(columnSchema: SchemaEntry, params: ColumnHistogramParams,
		stats: Map<string, any>): Promise<ColumnHistogram> {
		const field = columnSchema.column_name;

		// After everything works, we can work on computing all histograms as a one-shot for
		// potentially better performance
		const numRows = Number(stats.get('num_rows'));

		// If numRows is 0, this is handled earlier

		// TODO: This may be lossy for very large INT64 values
		// We used strings here to temporarily support decimal type data that fits in float64.
		// We will need to return later to support broader-spectrum decimals
		const minValue = Number(stats.get(statColumnName(field, 'string_min')));
		const maxValue = Number(stats.get(statColumnName(field, 'string_max')));

		// Exceptional cases to worry about
		// - Inf/-Inf values in min/max/iqr
		// - NaN values
		const peakToPeak = maxValue - minValue;

		let binWidth = 0;
		switch (params.method) {
			case ColumnHistogramParamsMethod.Fixed: {
				binWidth = peakToPeak / params.num_bins;
				break;
			}
			case ColumnHistogramParamsMethod.FreedmanDiaconis: {
				const iqr = Number(stats.get(statColumnName(field, 'iqr')));
				if (iqr > 0) {
					binWidth = 2 * iqr * Math.pow(numRows, -1 / 3);
				}
				break;
			}
			case ColumnHistogramParamsMethod.Sturges: {
				if (peakToPeak > 0) {
					binWidth = peakToPeak / (Math.log2(numRows) + 1);
				}
				break;
			}
			case ColumnHistogramParamsMethod.Scott:
			default:
				// Not yet implemented
				break;
		}

		const nullCount = Number(stats.get(statColumnName(field, 'null_count')));
		if (nullCount === numRows) {
			return {
				bin_edges: ['NULL', 'NULL'],
				bin_counts: [nullCount],
				quantiles: []
			};
		} else if (binWidth === 0) {
			const predicate = `${quoteIdentifier(field)} IS NOT NULL`;
			const composedPred = this.whereClause !== '' ?
				`${this.whereClause} AND ${predicate}` :
				`WHERE ${predicate}`;
			const result = await this.db.runQuery(`SELECT ${quoteIdentifier(field)}::VARCHAR AS value
			FROM ${this.tableName} ${composedPred} LIMIT 1;`);

			const fixedValue = result.toArray()[0].value;

			return {
				bin_edges: [fixedValue, fixedValue],
				bin_counts: [numRows - nullCount],
				quantiles: []
			};
		}

		let numBins = Math.ceil(peakToPeak / binWidth);
		// If number of bins from estimate is larger than the number passed by the UI,
		// which is treated as a maximum # of bins, we use the lower number
		if (numBins > params.num_bins) {
			numBins = params.num_bins;
			binWidth = peakToPeak / numBins;
		}

		// For integer types, if the peak-to-peak range is larger than the # bins from the
		// estimator, we use the p-t-p range instead for the number of bins
		if (isInteger(columnSchema.column_type) && peakToPeak <= numBins) {
			numBins = peakToPeak + 1;
			binWidth = peakToPeak / numBins;
		}

		// TODO: Casting to DOUBLE is not safe for BIGINT
		const result = await this.db.runQuery(`
		SELECT FLOOR((${quoteIdentifier(field)}::DOUBLE - ${minValue}) / ${binWidth})::INTEGER AS bin_id,
			COUNT(*) AS bin_count
		FROM ${this.tableName} ${this.whereClause}
		GROUP BY 1;`);

		const output: ColumnHistogram = {
			bin_edges: [],
			bin_counts: [],
			quantiles: []
		};
		const histEntries: Map<number, number> = new Map(
			result.toArray().map(entry => [entry.bin_id, entry.bin_count])
		);
		for (let i = 0; i < numBins; ++i) {
			output.bin_edges.push((minValue + binWidth * i).toString());
			output.bin_counts.push(Number(histEntries.get(i) ?? 0));
		}

		// Since the last bin edge is exclusive, we need to add its count to the last bin
		output.bin_counts[numBins - 1] += Number(histEntries.get(numBins) ?? 0);

		// Compute the push the last bin
		output.bin_edges.push((minValue + binWidth * numBins).toString());
		return output;
	}

	private unboxSummaryStats(
		columnSchema: SchemaEntry,
		stats: Map<string, any>
	): ColumnSummaryStats {
		const fieldName = columnSchema.column_name;
		const getStat = (statType: string) => stats.get(statColumnName(fieldName, statType));

		const formatNumber = (value: number) => {
			value = Number(value);

			if (value - Math.floor(value) === 0) {
				return value.toString();
			}

			if (Math.abs(value) < 1) {
				return value.toFixed(this.params.format_options.small_num_digits);
			} else {
				return value.toFixed(this.params.format_options.large_num_digits);
			}
		};

		if (isNumeric(columnSchema.column_type)) {
			return {
				type_display: getNumericDisplayType(columnSchema.column_type),
				number_stats: {
					min_value: formatNumber(getStat('min')),
					max_value: formatNumber(getStat('max')),
					mean: formatNumber(getStat('mean')),
					median: formatNumber(getStat('median')),
					stdev: formatNumber(getStat('stdev')),
				}
			};
		} else if (columnSchema.column_type.startsWith('DECIMAL')) {
			return {
				type_display: ColumnDisplayType.Decimal,
				number_stats: {
					min_value: getStat('string_min'),
					max_value: getStat('string_max'),
					mean: getStat('f64_mean')?.toString(),
					median: getStat('f64_median')?.toString(),
					stdev: getStat('f64_stdev')?.toString(),
				}
			};
		} else if (columnSchema.column_type === 'VARCHAR') {
			return {
				type_display: ColumnDisplayType.String,
				string_stats: {
					num_unique: Number(getStat('nunique')),
					num_empty: Number(getStat('nempty')),
				}
			};
		} else if (columnSchema.column_type === 'BOOLEAN') {
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: {
					true_count: Number(getStat('ntrue')),
					false_count: Number(getStat('nfalse')),
				}
			};
		} else if (columnSchema.column_type === 'TIMESTAMP') {
			return {
				type_display: ColumnDisplayType.Datetime,
				datetime_stats: {
					min_date: getStat('string_min'),
					max_date: getStat('string_max'),
					mean_date: getStat('string_mean'),
					median_date: getStat('string_median'),
					num_unique: Number(getStat('nunique'))
				}
			};
		} else {
			return {
				type_display: ColumnDisplayType.Unknown
			};
		}
	}

	async evaluate() {
		for (let i = 0; i < this.params.profiles.length; ++i) {
			this.collectStats(i, this.params.profiles[i]);
		}

		// Get all the needed summary statistics
		const statsQuery = `SELECT ${Array.from(this.statsExprs).join(',\n')}
		FROM ${this.tableName}${this.whereClause};`;

		// Table with a single row containing all the computed statistics
		const statsResult = await this.db.runQuery(statsQuery);

		const stats = new Map<string, any>(statsResult.columnNames.map((value) => {
			const column = statsResult.columnByName(value);
			return [value, column[0]] as [string, any];
		}));

		const results: Array<ColumnProfileResult> = [];
		for (let i = 0; i < this.params.profiles.length; ++i) {
			const request = this.params.profiles[i];

			const columnSchema = this.fullSchema[request.column_index];
			const field = columnSchema.column_name;

			// const numRows = Number(stats.get('num_rows'));

			const result: ColumnProfileResult = {};
			for (const spec of request.profiles) {
				switch (spec.profile_type) {
					case ColumnProfileType.NullCount:
						result.null_count = Number(stats.get(statColumnName(field, 'null_count')));
						break;
					case ColumnProfileType.LargeHistogram:
					case ColumnProfileType.SmallHistogram:
						result[spec.profile_type] = await this.computeHistogram(
							columnSchema, spec.params as ColumnHistogramParams, stats
						);
						break;
					case ColumnProfileType.LargeFrequencyTable:
					case ColumnProfileType.SmallFrequencyTable:
						result[spec.profile_type] = await this.computeFreqTable(
							columnSchema, spec.params as ColumnFrequencyTableParams, stats
						);
						break;
					case ColumnProfileType.SummaryStats:
						result.summary_stats = this.unboxSummaryStats(columnSchema, stats);
						break;
					default:
						break;
				}
			}
			results.push(result);
		}

		return results;
	}
}

function isInteger(duckdbName: string) {
	switch (duckdbName) {
		case 'UTINYINT':
		case 'TINYINT':
		case 'USMALLINT':
		case 'SMALLINT':
		case 'UINTEGER':
		case 'INTEGER':
		case 'UBIGINT':
		case 'BIGINT':
			return true;
		default:
			return false;
	}
}

function isFloating(duckdbName: string) {
	return duckdbName === 'FLOAT' || duckdbName === 'DOUBLE';
}

function isNumeric(duckdbName: string) {
	return (
		isInteger(duckdbName) ||
		isFloating(duckdbName)
	);
}

function getNumericDisplayType(duckdbName: string): ColumnDisplayType {
	if (isInteger(duckdbName)) {
		return ColumnDisplayType.Integer;
	} else if (isFloating(duckdbName)) {
		return ColumnDisplayType.Floating;
	} else if (duckdbName.startsWith('DECIMAL')) {
		return ColumnDisplayType.Decimal;
	} else {
		// Fallback to Floating for any other numeric type
		return ColumnDisplayType.Floating;
	}
}

/**
 * Interface for serving data explorer requests for a particular table in DuckDB
 */
export class DuckDBTableView {
	private sortKeys: Array<ColumnSortKey> = [];
	private rowFilters: Array<RowFilter> = [];
	private columnFilters: Array<ColumnFilter> = [];

	private _unfilteredShape: Promise<[number, number]>;
	private _filteredShape: Promise<[number, number]>;

	private _sortClause: string = '';
	private _whereClause: string = '';

	/**
	 * Import options for delimited files and Excel workbooks. Can be modified to
	 * reimport the file with different settings.
	 */
	importOptions?: DatasetImportOptions;

	/**
	 * For Excel workbooks, the names of the worksheets available to read, in
	 * workbook order. Undefined for other data sources (and for workbooks whose
	 * sheet names could not be read).
	 */
	availableSheets?: string[];

	constructor(
		readonly uri: vscode.Uri,
		private tableName: string,
		private fullSchema: Array<SchemaEntry>,
		readonly db: DuckDBInstance,
		private readonly sendUiEvent: (event: DataExplorerUiEvent) => void,
		readonly isConnected: boolean = true,
		readonly errorMessage: string = ''
	) {
		if (isConnected) {
			this._unfilteredShape = this._getShape();
		} else {
			this._unfilteredShape = Promise.resolve([0, 0]);
		}
		this._filteredShape = this._unfilteredShape;
	}

	async onFileUpdated(newTableName: string, newSchema: Array<SchemaEntry>) {
		if (!this.isConnected) {
			return;
		}

		this.tableName = newTableName;
		this.fullSchema = newSchema;

		this._unfilteredShape = this._getShape();

		// Need to re-apply the row filters, if any
		await this._applyRowFilters();

		// When the file changes, refuse to guess and send SchemaUpdate event
		this.sendUiEvent({
			uri: this.uri.toString(),
			method: DataExplorerFrontendEvent.SchemaUpdate,
			params: {}
		});
	}

	static getDisconnected(uri: vscode.Uri, errorMessage: string, db: DuckDBInstance, sendUiEvent: (event: DataExplorerUiEvent) => void) {
		return new DuckDBTableView(uri, 'disconnected', [], db, sendUiEvent, false, errorMessage);
	}

	async getSchema(params: GetSchemaParams): RpcResponse<TableSchema> {
		return {
			columns: params.column_indices.map((index) => {
				const entry = this.fullSchema[index];
				let type_display = SCHEMA_TYPE_MAPPING.get(entry.column_type);
				if (type_display === undefined) {
					type_display = ColumnDisplayType.Unknown;
				}

				// If entry.column_type is like DECIMAL($p,$s), set type_display to Decimal
				if (entry.column_type.startsWith('DECIMAL')) {
					type_display = ColumnDisplayType.Decimal;
				}

				return {
					column_name: entry.column_name,
					column_index: index,
					type_name: entry.column_type,
					type_display
				};
			}),
		};
	}

	async searchSchema(
		params: SearchSchemaParams,
	): RpcResponse<SearchSchemaResult> {
		// Get all column indices
		const allIndices: number[] = [];
		for (let i = 0; i < this.fullSchema.length; i++) {
			allIndices.push(i);
		}

		// Apply filters if any
		let filteredIndices = allIndices;
		if (params.filters && params.filters.length > 0) {
			filteredIndices = allIndices.filter((index) => {
				const entry = this.fullSchema[index];
				const columnName = entry.column_name;
				const columnType = entry.column_type;

				// Get display type for this column
				let displayType = SCHEMA_TYPE_MAPPING.get(columnType);
				if (displayType === undefined) {
					displayType = ColumnDisplayType.Unknown;
				}
				if (columnType.startsWith('DECIMAL')) {
					displayType = ColumnDisplayType.Decimal;
				}

				// Apply each filter
				return params.filters.every((filter) => {
					switch (filter.filter_type) {
						case ColumnFilterType.TextSearch: {
							const textFilter =
								filter.params as FilterTextSearch;
							const searchTerm = textFilter.case_sensitive
								? textFilter.term
								: textFilter.term.toLowerCase();
							const columnNameToMatch = textFilter.case_sensitive
								? columnName
								: columnName.toLowerCase();

							switch (textFilter.search_type) {
								case TextSearchType.Contains:
									return columnNameToMatch.includes(
										searchTerm,
									);
								case TextSearchType.NotContains:
									return !columnNameToMatch.includes(
										searchTerm,
									);
								case TextSearchType.StartsWith:
									return columnNameToMatch.startsWith(
										searchTerm,
									);
								case TextSearchType.EndsWith:
									return columnNameToMatch.endsWith(
										searchTerm,
									);
								case TextSearchType.RegexMatch:
									try {
										const regex = new RegExp(
											textFilter.term,
											textFilter.case_sensitive
												? ''
												: 'i',
										);
										return regex.test(columnName);
									} catch {
										return false;
									}
								default:
									return false;
							}
						}
						case ColumnFilterType.MatchDataTypes: {
							const typeFilter =
								filter.params as FilterMatchDataTypes;
							return typeFilter.display_types.includes(
								displayType,
							);
						}
						default:
							return false;
					}
				});
			});
		}

		// Sort the filtered indices
		switch (params.sort_order) {
			case SearchSchemaSortOrder.AscendingName:
				filteredIndices.sort((a, b) => {
					const nameA = this.fullSchema[a].column_name.toLowerCase();
					const nameB = this.fullSchema[b].column_name.toLowerCase();
					return nameA.localeCompare(nameB);
				});
				break;
			case SearchSchemaSortOrder.DescendingName:
				filteredIndices.sort((a, b) => {
					const nameA = this.fullSchema[a].column_name.toLowerCase();
					const nameB = this.fullSchema[b].column_name.toLowerCase();
					return nameB.localeCompare(nameA);
				});
				break;
			case SearchSchemaSortOrder.AscendingType:
				filteredIndices.sort((a, b) => {
					const typeA = this.fullSchema[a].column_type.toLowerCase();
					const typeB = this.fullSchema[b].column_type.toLowerCase();
					return typeA.localeCompare(typeB);
				});
				break;
			case SearchSchemaSortOrder.DescendingType:
				filteredIndices.sort((a, b) => {
					const typeA = this.fullSchema[a].column_type.toLowerCase();
					const typeB = this.fullSchema[b].column_type.toLowerCase();
					return typeB.localeCompare(typeA);
				});
				break;
			case SearchSchemaSortOrder.Original:
			default:
				// Keep original order
				break;
		}

		return {
			matches: filteredIndices,
		};
	}

	async getDataValues(params: GetDataValuesParams): RpcResponse<TableData> {
		// Because DuckDB is a SQL engine, we opt to always select a row range of
		// formatted data for a range of rows, and then return the requested selections
		// based on what the UI requested. This blunt approach could end up being wasteful in
		// some cases, but doing fewer queries / scans in the average case should yield better
		// performance.

		// First, check if the filtered table has any rows at all
		const [filteredNumRows, _] = await this._filteredShape;
		if (filteredNumRows === 0) {
			// If the table has 0 rows due to filtering, return empty columns immediately
			return {
				columns: Array.from({ length: params.columns.length }, () => [])
			};
		}

		let lowerLimit = Infinity;
		let upperLimit = -Infinity;

		const smallNumDigits = params.format_options.small_num_digits;
		const largeNumDigits = params.format_options.large_num_digits;

		const thousandsSep = params.format_options.thousands_sep;
		const sciNotationLimit = '1' + '0'.repeat(params.format_options.max_integral_digits);
		const varcharLimit = params.format_options.max_value_length;

		let smallFloatFormat, largeFloatFormat;
		if (thousandsSep) {
			largeFloatFormat = `'{:,.${largeNumDigits}f}'`;
			smallFloatFormat = `'{:,.${smallNumDigits}f}'`;
		} else {
			largeFloatFormat = `'{:.${largeNumDigits}f}'`;
			smallFloatFormat = `'{:.${smallNumDigits}f}'`;
		}

		const columnSelectors = [];
		const selectedColumns = [];
		for (const column of params.columns) {
			if (isSelectionRange(column.spec)) {
				// Value range
				lowerLimit = Math.min(lowerLimit, column.spec.first_index);
				upperLimit = Math.max(upperLimit, column.spec.last_index);
			} else {
				// Set of values indices, just get the lower and upper extent
				lowerLimit = Math.min(lowerLimit, ...column.spec.indices);
				upperLimit = Math.max(upperLimit, ...column.spec.indices);
			}

			const columnSchema = this.fullSchema[column.column_index];
			const quotedName = quoteIdentifier(columnSchema.column_name);

			const smallRounded = `ROUND(${quotedName}, ${smallNumDigits})`;
			const largeRounded = `ROUND(${quotedName}, ${largeNumDigits})`;

			// TODO: what is column_index is out of bounds?

			// Build column selector. Just casting to string for now
			let columnSelector;
			switch (columnSchema.column_type) {
				case 'TINYINT':
				case 'SMALLINT':
				case 'INTEGER':
				case 'BIGINT':
					if (thousandsSep && thousandsSep !== undefined) {
						columnSelector = `FORMAT('{:,}', ${quotedName})`;
						if (thousandsSep !== ',') {
							columnSelector = `REPLACE(${columnSelector}, ',', '${thousandsSep}')`;
						}
					} else {
						columnSelector = `FORMAT('{:d}', ${quotedName})`;
					}
					break;
				case 'FLOAT':
				case 'DOUBLE': {
					let largeFormatter = `FORMAT(${largeFloatFormat}, ${largeRounded})`;
					let smallFormatter = `FORMAT(${smallFloatFormat}, ${smallRounded})`;
					if (thousandsSep && thousandsSep !== ',') {
						largeFormatter = `REPLACE(${largeFormatter}, ',', '${thousandsSep}')`;
						smallFormatter = `REPLACE(${smallFormatter}, ',', '${thousandsSep}')`;
					}
					columnSelector = `CASE WHEN ${quotedName} IS NULL THEN 'NULL'
WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
WHEN isinf(${quotedName}) AND ${quotedName} < 0 THEN '-Inf'
WHEN isnan(${quotedName}) THEN 'NaN'
WHEN abs(${quotedName}) >= ${sciNotationLimit} THEN FORMAT('{:.${largeNumDigits}e}', ${quotedName})
WHEN abs(${quotedName}) < 1 AND abs(${quotedName}) > 0 THEN ${smallFormatter}
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
			selectedColumns.push(quotedName);
			columnSelectors.push(`${columnSelector} AS formatted_${columnSelectors.length} `);
		}

		let numRows = 0;
		if (isFinite(lowerLimit) && isFinite(upperLimit)) {
			// Limits are inclusive
			numRows = upperLimit - lowerLimit + 1;
		}

		// No column selectors case, do not error if we get a request like this
		if (columnSelectors.length === 0) {
			return { columns: [] };
		} else if (numRows === 0) {
			return {
				columns: Array.from({ length: params.columns.length }, () => [])
			};
		}

		// For some reason, DuckDB performs better if you do your sort/limit/offset in a subquery
		// and then format that small selection.
		const query = `SELECT\n${columnSelectors.join(',\n    ')}
		FROM (
			SELECT ${selectedColumns.join(', ')} FROM
			${this.tableName}${this._whereClause}${this._sortClause}
			LIMIT ${numRows}
			OFFSET ${lowerLimit}
		) t;`;

		const queryResult = await this.db.runQuery(query);

		// Sanity check
		if (queryResult.numCols !== params.columns.length) {
			throw new Error('Incorrect number of columns in query result');
		}

		const result: TableData = {
			columns: []
		};

		const floatAdapter = (field: any[], i: number) => {
			const value: string = field[i - lowerLimit];
			switch (value) {
				case 'NaN':
					return SENTINEL_NAN;
				case 'NULL':
					return SENTINEL_NULL;
				case 'Inf':
					return SENTINEL_INF;
				case '-Inf':
					return SENTINEL_NEGINF;
				default:
					return value;
			}
		};

		const defaultAdapter = (field: any[], i: number) => {
			const relIndex = i - lowerLimit;
			const value = field[relIndex];
			return value === null || value === undefined ? SENTINEL_NULL : value;
		};

		for (let i = 0; i < queryResult.numCols; i++) {
			const column = params.columns[i];
			const spec = column.spec;
			const field = queryResult.columnAt(i);

			const fetchValues = (adapter: (field: any[], i: number) => ColumnValue) => {
				if (isSelectionRange(spec)) {
					// There may be fewer rows available than what was requested
					const lastIndex = Math.min(
						spec.last_index,
						spec.first_index + queryResult.numRows - 1
					);

					const columnValues: Array<string | number> = [];
					// Value range, we need to extract the actual slice requested
					for (let i = spec.first_index; i <= lastIndex; ++i) {
						columnValues.push(adapter(field, i));
					}
					return columnValues;
				} else {
					// Set of values indices, just get the lower and upper extent
					return spec.indices.map(i => adapter(field, i));
				}
			};

			const columnSchema = this.fullSchema[column.column_index];
			switch (columnSchema.column_type) {
				case 'DOUBLE':
				case 'FLOAT':
					result.columns.push(fetchValues(floatAdapter));
					break;
				default:
					result.columns.push(fetchValues(defaultAdapter));
					break;
			}

		}

		return result;
	}

	async getRowLabels(params: GetRowLabelsParams): RpcResponse<TableRowLabels> {
		return 'not implemented';
	}

	private getDisconnectedState(): BackendState {
		return {
			display_name: this.uri.path,
			connected: false,
			error_message: this.errorMessage,
			table_shape: { num_rows: 0, num_columns: 0 },
			table_unfiltered_shape: { num_rows: 0, num_columns: 0 },
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
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_sort_columns: { support_status: SupportStatus.Unsupported, },
				export_data_selection: {
					support_status: SupportStatus.Unsupported,
					supported_formats: []
				},
				convert_to_code: {
					support_status: SupportStatus.Unsupported,
				}
			}
		};

	}

	async getState(): RpcResponse<BackendState> {
		if (!this.isConnected) {
			return this.getDisconnectedState();
		}

		const [unfiltedNumRows, unfilteredNumCols] = await this._unfilteredShape;
		const [filteredNumRows, filteredNumCols] = await this._filteredShape;
		return {
			display_name: path.basename(this.uri.path),
			table_shape: {
				num_rows: filteredNumRows,
				num_columns: filteredNumCols
			},
			table_unfiltered_shape: {
				num_rows: unfiltedNumRows,
				num_columns: unfilteredNumCols
			},
			has_row_labels: false,
			// Only present for Excel workbooks; omitted entirely otherwise so the
			// state shape is unchanged for CSV/TSV/Parquet sources.
			...(this.availableSheets ? { available_sheets: this.availableSheets } : {}),
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
						},
						{
							profile_type: ColumnProfileType.SummaryStats,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.SmallFrequencyTable,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.LargeFrequencyTable,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.SmallHistogram,
							support_status: SupportStatus.Supported
						},
						{
							profile_type: ColumnProfileType.LargeHistogram,
							support_status: SupportStatus.Supported
						}
					]
				},
				search_schema: {
					support_status: SupportStatus.Supported,
					supported_types: [
						{
							column_filter_type: ColumnFilterType.TextSearch,
							support_status: SupportStatus.Supported,
						},
						{
							column_filter_type: ColumnFilterType.MatchDataTypes,
							support_status: SupportStatus.Supported,
						}
					],
				},
				set_column_filters: {
					support_status: SupportStatus.Unsupported,
					supported_types: []
				},
				set_row_filters: {
					support_status: SupportStatus.Supported,
					supports_conditions: SupportStatus.Unsupported,
					supported_types: [
						{
							row_filter_type: RowFilterType.Between,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.Compare,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsEmpty,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsFalse,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsNull,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.IsTrue,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.NotBetween,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.NotEmpty,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.NotNull,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.Search,
							support_status: SupportStatus.Supported
						},
						{
							row_filter_type: RowFilterType.SetMembership,
							support_status: SupportStatus.Supported
						}
					]
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
					code_syntaxes: [{ code_syntax_name: 'SQL' }]
				}
			}
		};
	}

	async getColumnProfiles(params: GetColumnProfilesParams): RpcResponse<void> {
		// Initiate but do not await profile evaluations
		this._evaluateColumnProfiles(params);
	}

	/**
	 * Creates empty summary statistics for a column when there are zero rows
	 * @param columnSchema Column schema information
	 * @returns Empty summary stats appropriate for the column type
	 */
	private createEmptySummaryStats(columnSchema: SchemaEntry): ColumnSummaryStats {
		if (isNumeric(columnSchema.column_type) || columnSchema.column_type.startsWith('DECIMAL')) {
			const displayType = columnSchema.column_type.startsWith('DECIMAL')
				? ColumnDisplayType.Decimal
				: getNumericDisplayType(columnSchema.column_type);
			return {
				type_display: displayType,
				number_stats: {}
			};
		} else if (columnSchema.column_type === 'VARCHAR') {
			return {
				type_display: ColumnDisplayType.String,
				string_stats: {
					num_unique: 0,
					num_empty: 0
				}
			};
		} else if (columnSchema.column_type === 'BOOLEAN') {
			return {
				type_display: ColumnDisplayType.Boolean,
				boolean_stats: {
					true_count: 0,
					false_count: 0
				}
			};
		} else if (columnSchema.column_type === 'TIMESTAMP') {
			return {
				type_display: ColumnDisplayType.Datetime,
				datetime_stats: {
					num_unique: 0
				}
			};
		} else {
			return {
				type_display: ColumnDisplayType.Unknown
			};
		}
	}

	private async _evaluateColumnProfiles(params: GetColumnProfilesParams) {
		// Check if there are any rows in the filtered data
		const [filteredRowCount, _] = await this._filteredShape;

		const outParams: ReturnColumnProfilesEvent = {
			callback_id: params.callback_id,
			profiles: []
		};

		if (filteredRowCount === 0) {
			// Handle the zero-row case - return empty/null profiles
			outParams.profiles = params.profiles.map(request => {
				// Create an empty result with appropriate null values
				const result: ColumnProfileResult = {};

				for (const spec of request.profiles) {
					switch (spec.profile_type) {
						case ColumnProfileType.NullCount:
							result.null_count = 0;
							break;
						case ColumnProfileType.LargeHistogram:
						case ColumnProfileType.SmallHistogram:
							result[spec.profile_type] = {
								bin_edges: ['NULL', 'NULL'],
								bin_counts: [0],
								quantiles: []
							};
							break;
						case ColumnProfileType.LargeFrequencyTable:
						case ColumnProfileType.SmallFrequencyTable:
							result[spec.profile_type] = {
								values: [],
								counts: [],
								other_count: 0
							};
							break;
						case ColumnProfileType.SummaryStats: {
							// Create null summary stats appropriate for the column type
							const columnSchema = this.fullSchema[request.column_index];
							result.summary_stats = this.createEmptySummaryStats(columnSchema);
							break;
						}
					}
				}
				return result;
			});
		} else {
			// Normal case - compute stats using evaluator
			const evaluator = new ColumnProfileEvaluator(this.db,
				this.fullSchema,
				this.tableName,
				this._whereClause,
				params
			);

			try {
				outParams.profiles = await evaluator.evaluate();
			} catch (error) {
				// TODO: Add error message to ReturnColumnProfilesEvent and display in UI
				const errorMessage = error instanceof Error ? error.message : 'unknown error';
				console.log(`Failed to compute column profiles: ${errorMessage}`);
			}
		}

		this.sendUiEvent({
			uri: this.uri.toString(),
			method: DataExplorerFrontendEvent.ReturnColumnProfiles,
			params: outParams
		});
	}

	async setRowFilters(params: SetRowFiltersParams): RpcResponse<FilterResult> {
		this.rowFilters = params.filters;
		await this._applyRowFilters();
		const newShape = await this._filteredShape;
		return { selected_num_rows: newShape[0] };
	}

	private async _applyRowFilters() {
		if (this.rowFilters.length === 0) {
			this._whereClause = '';
			const unfilteredShape = await this._unfilteredShape;

			// reset filtered shape
			this._filteredShape = this._unfilteredShape;

			return { selected_num_rows: unfilteredShape[0] };
		}

		const whereExprs = this.rowFilters.map(makeWhereExpr);
		this._whereClause = `\nWHERE ${whereExprs.join(' AND ')}`;
		this._filteredShape = this._getShape(this._whereClause);
	}

	async setSortColumns(params: SetSortColumnsParams): RpcResponse<void> {
		this.sortKeys = params.sort_keys;
		if (this.sortKeys.length === 0) {
			this._sortClause = '';
			return;
		}

		const sortExprs = [];
		for (const sortKey of this.sortKeys) {
			const columnSchema = this.fullSchema[sortKey.column_index];
			const quotedName = quoteIdentifier(columnSchema.column_name);
			const modifier = sortKey.ascending ? '' : ' DESC';
			sortExprs.push(`${quotedName}${modifier}`);
		}

		// Add rowid as the final sort key to ensure stable sorting
		// This prevents inconsistencies when there are duplicate values in the sort columns
		sortExprs.push('rowid');

		this._sortClause = `\nORDER BY ${sortExprs.join(', ')}`;
	}

	async exportDataSelection(params: ExportDataSelectionParams): RpcResponse<ExportedData> {
		const kind = params.selection.kind;

		const exportQueryOutput = async (query: string,
			columns: Array<SchemaEntry>): Promise<ExportedData> => {
			const result = await this.db.runQuery(query);
			const names = result.columnNames;
			const unboxed = [
				columns.map(s => s.column_name),
				...result.toArray().map(row => names.map(name => row[name]))
			];

			let data;
			switch (params.format) {
				case ExportFormat.Csv:
					data = unboxed.map(row => row.join(',')).join('\n');
					break;
				case ExportFormat.Tsv:
					data = unboxed.map(row => row.join('\t')).join('\n');
					break;
				case ExportFormat.Html:
					data = unboxed.map(row => `<tr><td>${row.join('</td><td>')}</td></tr>`).join('\n');
					break;
				default:
					throw new Error(`Unknown export format: ${params.format}`);
			}

			return {
				data,
				format: params.format,
			};
		};

		const getColumnSelectors = (columns: Array<SchemaEntry>) => {
			const columnSelectors = [];
			for (const column of columns) {
				const quotedName = quoteIdentifier(column.column_name);

				// Build column selector. Just casting to string for now
				let columnSelector;
				switch (column.column_type) {
					case 'FLOAT':
					case 'DOUBLE': {
						columnSelector = `CASE WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
	WHEN isinf(${quotedName}) AND ${quotedName} < 0 THEN '-Inf'
	WHEN isnan(${quotedName}) THEN 'NaN'
	ELSE CAST(${quotedName} AS VARCHAR)
	END`;
						break;
					}
					case 'TIMESTAMP':
						columnSelector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
						break;
					case 'TIMESTAMP WITH TIME ZONE':
						columnSelector = `strftime(${quotedName}, '%Y-%m-%d %H:%M:%S%z')`;
						break;
					case 'VARCHAR':
					case 'TINYINT':
					case 'SMALLINT':
					case 'INTEGER':
					case 'BIGINT':
					case 'DATE':
					case 'TIME':
					default:
						columnSelector = `CAST(${quotedName} AS VARCHAR)`;
						break;
				}
				columnSelectors.push(
					`CASE WHEN ${quotedName} IS NULL THEN 'NULL' ELSE ${columnSelector} END
					AS formatted_${columnSelectors.length} `);
			}
			return columnSelectors;
		};

		let data: string;
		switch (kind) {
			case TableSelectionKind.SingleCell: {
				const selection = params.selection.selection as DataSelectionSingleCell;
				const rowIndex = selection.row_index;
				const columnIndex = selection.column_index;
				const schema = this.fullSchema[columnIndex];
				const selector = getColumnSelectors([schema])[0];
				const query = `SELECT ${selector} FROM ${this.tableName}${this._whereClause}${this._sortClause} LIMIT 1 OFFSET ${rowIndex};`;
				const result = await this.db.runQuery(query);
				return {
					data: result.toArray()[0][result.columnNames[0]],
					format: params.format
				};
			}
			case TableSelectionKind.CellRange: {
				const selection = params.selection.selection as DataSelectionCellRange;
				const rowStart = selection.first_row_index;
				const rowEnd = selection.last_row_index;
				const columnStart = selection.first_column_index;
				const columnEnd = selection.last_column_index;
				const columns = this.fullSchema.slice(columnStart, columnEnd + 1);
				const query = `SELECT ${getColumnSelectors(columns).join(',')}
				FROM ${this.tableName}${this._whereClause}${this._sortClause}
				LIMIT ${rowEnd - rowStart + 1} OFFSET ${rowStart};`;
				return await exportQueryOutput(query, columns);
			}
			case TableSelectionKind.RowRange: {
				const selection = params.selection.selection as DataSelectionRange;
				const rowStart = selection.first_index;
				const rowEnd = selection.last_index;
				const query = `SELECT ${getColumnSelectors(this.fullSchema).join(',')}
				FROM ${this.tableName}${this._whereClause}${this._sortClause}
				LIMIT ${rowEnd - rowStart + 1} OFFSET ${rowStart};`;
				return await exportQueryOutput(query, this.fullSchema);
			}
			case TableSelectionKind.ColumnRange: {
				const selection = params.selection.selection as DataSelectionRange;
				const columnStart = selection.first_index;
				const columnEnd = selection.last_index;
				const columns = this.fullSchema.slice(columnStart, columnEnd + 1);
				const query = `SELECT ${getColumnSelectors(columns).join(',')}
				FROM ${this.tableName}${this._whereClause}${this._sortClause}`;
				return await exportQueryOutput(query, columns);
			}
			case TableSelectionKind.RowIndices: {
				const selection = params.selection.selection as DataSelectionIndices;
				const indices = selection.indices;
				const whereCondition = this._whereClause
					? `${this._whereClause} AND rowid IN (${indices.join(', ')})`
					: `\nWHERE rowid IN (${indices.join(', ')})`;
				const query = `SELECT ${getColumnSelectors(this.fullSchema).join(',')}
				FROM ${this.tableName}${whereCondition}${this._sortClause}`;
				return await exportQueryOutput(query, this.fullSchema);
			}
			case TableSelectionKind.ColumnIndices: {
				const selection = params.selection.selection as DataSelectionIndices;
				const indices = selection.indices;
				const columns = indices.map(i => this.fullSchema[i]);
				const query = `SELECT ${getColumnSelectors(columns).join(',')}
				FROM ${this.tableName}${this._whereClause}${this._sortClause}`;
				return await exportQueryOutput(query, columns);
			}
			case TableSelectionKind.CellIndices: {
				const selection = params.selection.selection as DataSelectionCellIndices;
				const rowIndices = selection.row_indices;
				const columnIndices = selection.column_indices;
				const columns = columnIndices.map(i => this.fullSchema[i]);

				// For CellIndices, we need to respect both the table's sort order and the specific row selection order
				// First apply table filters and sorting to get the sorted view, then select specific rows from that
				if (this._sortClause || this._whereClause) {
					// Create a subquery with the sorted/filtered table, then select specific rows
					const sortedTableQuery = `SELECT *, ROW_NUMBER() OVER(${this._sortClause || 'ORDER BY rowid'}) - 1 AS sorted_row_index
					FROM ${this.tableName}${this._whereClause}${this._sortClause}`;

					const orderValues = rowIndices.map((rowIdx, idx) => `(${rowIdx}, ${idx})`).join(', ');
					const query = `SELECT ${getColumnSelectors(columns).join(',')}
					FROM (${sortedTableQuery}) sorted_table
					JOIN (VALUES ${orderValues}) AS row_order(sorted_row_index, selection_order) ON sorted_table.sorted_row_index = row_order.sorted_row_index
					ORDER BY row_order.selection_order`;
					return await exportQueryOutput(query, columns);
				} else {
					// No sorting/filtering, use the original simple approach
					const orderValues = rowIndices.map((rowId, idx) => `(${rowId}, ${idx})`).join(', ');
					const query = `SELECT ${getColumnSelectors(columns).join(',')}
					FROM ${this.tableName}
					JOIN (VALUES ${orderValues}) AS row_order(rowid, sort_order) ON ${this.tableName}.rowid = row_order.rowid
					ORDER BY row_order.sort_order`;
					return await exportQueryOutput(query, columns);
				}
			}
		}
	}
	private async _getShape(whereClause: string = ''): Promise<[number, number]> {
		const numColumns = this.fullSchema.length;
		const countStar = `SELECT count(*) AS num_rows
		FROM ${this.tableName}
		${whereClause};`;

		const result = await this.db.runQuery(countStar);
		// The count comes back as BigInt
		const numRows = Number(result.toArray()[0].num_rows);
		return [numRows, numColumns];
	}

	async suggestCodeSyntaxes(): RpcResponse<CodeSyntaxName> {
		return {
			code_syntax_name: 'SQL'
		};
	}

	async convertToCode(params: ConvertToCodeParams, uri: string): RpcResponse<ConvertedCode> {
		const parsedUri = vscode.Uri.parse(uri);
		const filename = path.basename(parsedUri.path, path.extname(parsedUri.path));

		// Escape any quotes in the filename to prevent SQL injection
		const escapedFilename = filename.replace(/"/g, '""');
		const result = ['SELECT * ', `FROM "${escapedFilename}"`];

		if (this._whereClause) {
			const whereClause = this._whereClause.replace(/\n/g, ' ').trim();
			result.push(whereClause);
		}

		if (this.sortKeys.length > 0) {
			// Generate user-facing sort clause without the auxiliary rowid
			const sortExprs = [];
			for (const sortKey of this.sortKeys) {
				const columnSchema = this.fullSchema[sortKey.column_index];
				const quotedName = quoteIdentifier(columnSchema.column_name);
				const modifier = sortKey.ascending ? '' : ' DESC';
				sortExprs.push(`${quotedName}${modifier}`);
			}
			result.push(`ORDER BY ${sortExprs.join(', ')}`);
		}

		return {
			converted_code: result
		};
	}
}

/**
 * Metadata returned from importing a file into the DuckDB catalog.
 */
interface CreateTableResult {
	/** For Excel workbooks, the worksheet names (if they could be read). */
	availableSheets?: string[];
}

/**
 * Implementation of Data Explorer backend protocol using native DuckDB,
 * for serving requests coming in through the vscode command.
 */
export class DataExplorerRpcHandler implements vscode.Disposable {
	private readonly _uriToTableView = new Map<string, DuckDBTableView>();
	/**
	 * Datasets with a currently-open data explorer, keyed by dataset URI. Distinct
	 * from `_uriToTableView`, whose entries are dropped on a crash and lazily
	 * rebuilt: this set tracks live clients so the worker can idle-shut-down once
	 * the last explorer closes. Added in {@link openDataset}, removed in
	 * {@link closeDataset}.
	 */
	private readonly _openDatasets = new Set<string>();
	private _tableIndex: number = 0;
	private _watchers: vscode.Disposable[] = [];
	private readonly _crashListener: vscode.Disposable;

	constructor(
		private readonly db: DuckDBInstance,
		private readonly sendUiEvent: (event: DataExplorerUiEvent) => void,
		private readonly storageDir: string,
	) {
		// If the DuckDB worker crashes (e.g. out of memory), its in-memory tables
		// are gone with it. Drop the cached table views so the next request for a
		// dataset re-imports it into the freshly respawned worker.
		this._crashListener = this.db.onDidCrash(() => this._uriToTableView.clear());
	}

	dispose() {
		this._crashListener.dispose();
		vscode.Disposable.from(...this._watchers).dispose();
	}

	async openDataset(params: OpenDatasetParams): Promise<OpenDatasetResult> {
		const uri = vscode.Uri.parse(params.uri);
		let tableView: DuckDBTableView;
		try {
			let tableName: string;
			let createResult: CreateTableResult | undefined;
			if (uri.scheme === 'duckdb') {
				// We are querying a table in the transient in-memory database. We can modify this later
				// to read from different .duckb database files
				tableName = uri.path;
			} else {
				tableName = `positron_${this._tableIndex++}`;
				// Importing inside this try is deliberate: a failed import (e.g. an
				// unreadable file or a missing Excel sheet) becomes a disconnected
				// table view whose error message the data explorer displays, rather
				// than rejecting open_dataset and leaving the explorer blank.
				createResult = await this.createTableFromUri(uri, tableName);
			}

			const result = await this.db.runQuery(`DESCRIBE ${tableName};`);
			tableView = new DuckDBTableView(uri, tableName, result.toArray(), this.db, this.sendUiEvent);
			tableView.availableSheets = createResult?.availableSheets;

			if (uri.scheme !== 'duckdb') {
				// Watch this dataset's file for changes. Scope the pattern to the
				// file itself (parent directory as base, exact file name as glob)
				// rather than the whole directory, so that changes to unrelated
				// sibling files don't trigger a spurious re-import of this dataset.
				const watchPattern = new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.basename(uri.path));
				const watcher = vscode.workspace.createFileSystemWatcher(watchPattern, true);
				watcher.onDidChange(async () => {
					try {
						const reload = async (importOptions?: DatasetImportOptions) => {
							const newTableName = `positron_${this._tableIndex++}`;
							const createResult = await this.createTableFromUri(uri, newTableName, importOptions);
							const newSchema = (await this.db.runQuery(`DESCRIBE ${newTableName};`)).toArray();
							tableView.importOptions = importOptions;
							tableView.availableSheets = createResult.availableSheets;
							await tableView.onFileUpdated(newTableName, newSchema);
						};

						try {
							await reload(tableView.importOptions);
						} catch (error) {
							// A workbook edited on disk may have had its selected sheet
							// renamed or removed, leaving a stale sheet_name that fails
							// every reload and strands the explorer on old data. Recover
							// by retrying once with the default (first) sheet so the
							// explorer reconnects to on-disk truth.
							if (tableView.importOptions?.sheet_name === undefined) {
								throw error;
							}
							await reload({ ...tableView.importOptions, sheet_name: undefined });
						}
					} catch (error) {
						// The file may have been changed-then-deleted, or otherwise
						// become unreadable, between the change event firing and the
						// re-import. This async handler must not throw: an unhandled
						// rejection here would surface unpredictably (e.g. failing an
						// unrelated test). Log and leave the existing table in place.
						const errorMessage = error instanceof Error ? error.message : String(error);
						console.error(`Failed to reload dataset after file change (${uri.toString()}): ${errorMessage}`);
					}
				});
				// Stop watching deleted files.
				watcher.onDidDelete(() => watcher.dispose());
				this._watchers.push(watcher);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ?
				error.message : 'Unable to open for unknown reason';
			tableView = DuckDBTableView.getDisconnected(uri, errorMessage, this.db, this.sendUiEvent);

		}
		this._uriToTableView.set(params.uri.toString(), tableView);
		// A dataset is open, so the worker has a live client: cancel any pending
		// idle shutdown. (Re-imports after a crash pass through here too; the set
		// add is idempotent.)
		this._openDatasets.add(params.uri.toString());
		debugLog(`Opened dataset ${params.uri.toString()}; open datasets: ${this._openDatasets.size}`);
		this.db.cancelIdleShutdown();
		return {};
	}

	/**
	 * Called by the host when a data explorer for a dataset closes. Drops the
	 * dataset's table view and, once no explorers remain open, asks the worker to
	 * idle-shut-down after a cooldown so its native memory is reclaimed.
	 */
	closeDataset(uri: string): void {
		this._uriToTableView.delete(uri);
		this._openDatasets.delete(uri);
		debugLog(`Closed dataset ${uri}; open datasets: ${this._openDatasets.size}`);
		if (this._openDatasets.size === 0) {
			this.db.requestIdleShutdown();
		}
	}

	/**
	 * Import data file into DuckDB by creating table or view
	 * @param uri A URI, usually for a file path on disk.
	 * @param catalogName The table name to use in the DuckDB catalog.
	 * @param importOptions Optional import options for delimited files and Excel workbooks.
	 * @returns Metadata about the imported table (e.g. the Excel sheet names).
	 */
	async createTableFromUri(uri: vscode.Uri, catalogName: string, importOptions?: DatasetImportOptions): Promise<CreateTableResult> {
		// Lower-case the extension for all format detection below. The editor
		// resolver routes files case-insensitively (e.g. REPORT.XLSX opens here),
		// so the backend must recognize uppercase/mixed-case extensions too.
		let fileExt = path.extname(uri.path).toLowerCase();
		// DuckDB transparently decompresses gzip/zstd-wrapped CSV/TSV by file
		// extension, so we strip the compression extension to detect the inner
		// format. Parquet is handled separately below (its reader can't unwrap an
		// outer compression container).
		const compressionExt = fileExt === '.gz' || fileExt === '.zst' ? fileExt : '';
		const compression = fileExt === '.gz' ? 'gzip' : fileExt === '.zst' ? 'zstd' : undefined;
		if (compression) {
			fileExt = path.extname(uri.path.slice(0, -compressionExt.length)).toLowerCase();
		}
		const isParquet = fileExt === '.parquet' || fileExt === '.parq';
		const isXlsx = fileExt === '.xlsx';

		const getCsvImportQuery = (_filePath: string, options: Array<string>) => {
			return `CREATE OR REPLACE TABLE ${catalogName} AS
			SELECT * FROM read_csv_auto('${quoteLiteral(_filePath)}'${options.length ? ', ' : ''}${options.join(' ,')});`;
		};

		const importDelimited = async (filePath: string) => {
			const options: Array<string> = [];

			// Use import options if provided, otherwise default to header=true
			const hasHeader = importOptions?.has_header_row ?? true;
			options.push(`header=${hasHeader}`);

			if (fileExt === '.tsv') {
				options.push('delim=\'\t\'');
			} else if (fileExt !== '.csv' && fileExt !== '.tsv') {
				throw new Error(`Unsupported file extension: ${fileExt}`);
			}

			let query = getCsvImportQuery(filePath, options);
			try {
				await this.db.runQuery(query);
			} catch (error) {
				// Retry with sample_size=-1 to disable sampling if type inference fails
				options.push('sample_size=-1');
				query = getCsvImportQuery(filePath, options);
				await this.db.runQuery(query);
			}
		};

		// Resolve a filesystem path DuckDB can read directly. For local files we
		// can usually hand DuckDB the real path; it reads .gz/.zst-compressed
		// CSV/TSV transparently. We spill to a temporary file when either (a) the
		// URI is not a local file (e.g. untitled or virtual documents), or (b) it
		// is a compressed Parquet, whose outer container DuckDB's Parquet reader
		// cannot unwrap, so we decompress it ourselves first.
		let filePath: string;
		let tempDir: string | undefined;
		let spillContents: Uint8Array | undefined;
		if (uri.scheme === 'file' && !(isParquet && compression)) {
			filePath = uri.fsPath;
		} else {
			let fileContents = await vscode.workspace.fs.readFile(uri);
			let tempName = path.basename(uri.path);
			if (isParquet && compression) {
				fileContents = decompress(fileContents, compression);
				// Drop the compression extension now that the bytes are decompressed.
				tempName = path.basename(uri.path, compressionExt);
			}
			// Spill into a private (mode 0700) per-import directory so the
			// contents aren't readable by other users on shared hosts. os.tmpdir()
			// honors TMPDIR (POSIX) and TMP/TEMP (Windows). Creating the directory
			// before the try below guarantees the finally always cleans it up,
			// even if the write or import fails.
			tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'positron-duckdb-'));
			filePath = path.join(tempDir, tempName);
			spillContents = fileContents;
		}

		let availableSheets: string[] | undefined;
		try {
			if (spillContents !== undefined) {
				await fs.promises.writeFile(filePath, spillContents);
			}
			if (isParquet) {
				const query = `CREATE OR REPLACE TABLE ${catalogName} AS
				SELECT * FROM parquet_scan('${quoteLiteral(filePath)}');`;
				await this.db.runQuery(query);
			} else if (isXlsx) {
				availableSheets = await this.importXlsx(filePath, catalogName, uri, importOptions);
			} else {
				await importDelimited(filePath);
			}
		} finally {
			if (tempDir !== undefined) {
				// Best-effort cleanup; a failure here (e.g. a lingering handle on
				// Windows) must not mask the import result or error.
				await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => { });
			}
		}
		return { availableSheets };
	}

	/**
	 * Whether the bundled DuckDB `excel` extension has been loaded into the
	 * worker. Loading is deferred until the first `.xlsx` import so that CSV and
	 * Parquet sessions never pay for it, and so that a problem loading Excel
	 * support can never break those formats.
	 */
	private _excelExtensionLoaded = false;

	/**
	 * Ensure the bundled `excel` extension is loaded. Loads it from disk (rather
	 * than DuckDB's network autoload) so `.xlsx` support works offline. On macOS
	 * the loadable file is reconstructed outside the read-only app bundle; see
	 * `resolveExcelExtensionPath`. Throws a user-facing error if the bundled
	 * extension cannot be loaded.
	 */
	private async ensureExcelExtension(): Promise<void> {
		if (this._excelExtensionLoaded) {
			return;
		}
		const extensionPath = resolveExcelExtensionPath(this.storageDir);
		try {
			await this.db.runQuery(`LOAD '${quoteLiteral(extensionPath)}';`);
			this._excelExtensionLoaded = true;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			console.error(`Failed to load bundled DuckDB Excel extension (${extensionPath}): ${detail}`);
			throw new Error('Could not load Excel support. Please report this issue if it persists.');
		}
	}

	/**
	 * Import an `.xlsx` worksheet into DuckDB.
	 * @param filePath Resolved local path to the workbook.
	 * @param catalogName The table name to use in the DuckDB catalog.
	 * @param uri The original URI (for error messages).
	 * @param importOptions Optional header / sheet selection.
	 * @returns The worksheet names, or undefined if they could not be read.
	 */
	private async importXlsx(
		filePath: string,
		catalogName: string,
		uri: vscode.Uri,
		importOptions?: DatasetImportOptions
	): Promise<string[] | undefined> {
		await this.ensureExcelExtension();

		// Enumerate sheet names so the UI can offer a sheet picker and so we can
		// list valid sheets if the requested one is missing. A failure here must
		// not block the import: fall back to reading the default (first) sheet.
		const availableSheets = await readXlsxSheetNames(filePath);

		const hasHeader = importOptions?.has_header_row ?? true;
		const sheetName = importOptions?.sheet_name;

		// Build the import query. `extraOptions` lets the dimension-based recovery
		// path below append a range / error tolerance without duplicating the
		// header and sheet handling.
		const buildQuery = (extraOptions: string[]) => {
			const options = [`header=${hasHeader}`];
			if (sheetName) {
				options.push(`sheet='${quoteLiteral(sheetName)}'`);
			}
			options.push(...extraOptions);
			return `CREATE OR REPLACE TABLE ${catalogName} AS
			SELECT * FROM read_xlsx('${quoteLiteral(filePath)}', ${options.join(', ')});`;
		};

		// First attempt: let DuckDB auto-detect the used range from the cell data.
		// This is correct for well-formed sheets and never trusts the workbook's
		// advisory metadata.
		let firstError: unknown;
		try {
			await this.db.runQuery(buildQuery([]));
		} catch (error) {
			firstError = error;
		}

		// DuckDB derives the used range by anchoring on the first non-empty row. A
		// sheet with a sparse leading row -- e.g. a merged title cell spanning a
		// single column above the real table -- collapses to one column, or the
		// read fails outright on a type clash. When the read failed or the result
		// looks degenerate (<= 1 column, or no rows) AND the sheet's declared
		// <dimension> says the grid is genuinely larger, re-read with that explicit
		// range so the full grid is captured. <dimension> is only an advisory hint,
		// so we reach for it strictly as a recovery path, never on the happy path.
		const shape = firstError === undefined
			? await this._getTableShape(catalogName)
			: undefined;
		const looksDegenerate = shape === undefined || shape.numColumns <= 1 || shape.numRows === 0;

		if (looksDegenerate) {
			const dimensionRef = await readXlsxSheetDimension(filePath, sheetName);
			const dimension = dimensionRef ? parseXlsxRange(dimensionRef) : undefined;
			const dimensionImpliesMore = dimension !== undefined && (
				shape === undefined ||
				shape.numColumns < dimension.width ||
				shape.numRows === 0
			);
			if (dimensionImpliesMore) {
				try {
					// ignore_errors nulls cells that don't match the inferred column
					// type (common when header or footnote text shares a column with
					// numeric data) rather than failing the whole import.
					await this.db.runQuery(buildQuery([`range='${quoteLiteral(dimensionRef!)}'`, 'ignore_errors=true']));
					return availableSheets;
				} catch {
					// Recovery failed; fall through to surface the original error if
					// the first read also failed, otherwise keep the first result.
				}
			}
		}

		if (firstError !== undefined) {
			throw translateXlsxError(firstError, uri, sheetName, availableSheets);
		}
		return availableSheets;
	}

	/**
	 * Return the column and row counts of a table already present in the DuckDB
	 * catalog. Used to detect a degenerate `.xlsx` read.
	 * @param tableName The catalog table name.
	 * @returns The table's column and row counts.
	 */
	private async _getTableShape(tableName: string): Promise<{ numColumns: number; numRows: number }> {
		const describe = await this.db.runQuery(`DESCRIBE ${tableName};`);
		const count = await this.db.runQuery(`SELECT COUNT(*) AS n FROM ${tableName};`);
		return {
			numColumns: describe.numRows,
			numRows: Number(count.columnByName('n')[0])
		};
	}

	/**
	 * Set import options for a dataset and reimport the file.
	 * @param uri The URI of the dataset.
	 * @param params The import options to apply.
	 */
	async setDatasetImportOptions(uri: string, params: SetDatasetImportOptionsParams): Promise<SetDatasetImportOptionsResult> {
		const tableView = this._uriToTableView.get(uri);
		if (!tableView) {
			return { error_message: `No table view found for URI: ${uri}` };
		}

		// Reimport the file with the new options
		const newTableName = `positron_${this._tableIndex++}`;
		const parsedUri = vscode.Uri.parse(uri);

		try {
			const createResult = await this.createTableFromUri(parsedUri, newTableName, params.options);
			const newSchema = (await this.db.runQuery(`DESCRIBE ${newTableName};`)).toArray();
			// Only commit the new options once the reimport has succeeded. Storing
			// them before validation would leave a bad selection (e.g. a sheet that
			// doesn't exist) persisted on the table view, so the next file-change
			// auto-reload would reuse it and fail again.
			tableView.importOptions = params.options;
			tableView.availableSheets = createResult.availableSheets;
			await tableView.onFileUpdated(newTableName, newSchema);
			return {};
		} catch (error) {
			// createTableFromUri already translates xlsx failures into user-facing
			// messages; surface the message directly rather than wrapping it.
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			return { error_message: errorMessage };
		}
	}

	async handleRequest(rpc: DataExplorerRpc): Promise<DataExplorerResponse> {
		try {
			return { result: await this._dispatchRpc(rpc) };
		} catch (error) {
			if (error instanceof Error) {
				return { error_message: error.message };
			} else {
				return { error_message: `Unknown data explorer RPC error with with ${rpc.method}` };
			}
		}
	}

	private async _dispatchRpc(rpc: DataExplorerRpc): RpcResponse<any> {
		if (rpc.method === DataExplorerBackendRequest.OpenDataset) {
			return this.openDataset(rpc.params as OpenDatasetParams);
		}

		if (rpc.uri === undefined) {
			return `URI for open dataset must be provided: ${rpc.method} `;
		}

		// Handle SetDatasetImportOptions at the handler level since it needs
		// to reimport the file.
		if (rpc.method === DataExplorerBackendRequest.SetDatasetImportOptions) {
			return this.setDatasetImportOptions(rpc.uri, rpc.params as SetDatasetImportOptionsParams);
		}

		// Check if table view exists, and recreate it if missing (e.g., after extension host restart)
		let table = this._uriToTableView.get(rpc.uri.toString());
		if (!table) {
			// Recreate the table view by calling openDataset
			await this.openDataset({ uri: rpc.uri });
			table = this._uriToTableView.get(rpc.uri.toString());
			if (!table) {
				return `Failed to recreate table view for URI: ${rpc.uri}`;
			}
		}
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
			case DataExplorerBackendRequest.SearchSchema:
				return table.searchSchema(rpc.params as SearchSchemaParams);
			case DataExplorerBackendRequest.SuggestCodeSyntax:
				return table.suggestCodeSyntaxes();
			case DataExplorerBackendRequest.ConvertToCode:
				return table.convertToCode(rpc.params as ConvertToCodeParams, rpc.uri!);
			case DataExplorerBackendRequest.SetColumnFilters:
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
	// Create the native DuckDB database and close it when the extension unloads.
	const db = await DuckDBInstance.create();
	context.subscriptions.push({ dispose: () => db.close() });

	// Register a simple command that runs a DuckDB query
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

	// Register as a Data Explorer backend provider over the typed channel. The session lets the
	// handler push async frontend events (schema updates, column profiles) back to the UI.
	// Forward reference: the handler's closure captures `session`, which is only assigned once
	// registerRpcHandler returns below, so this must be `let` despite the single assignment.
	// eslint-disable-next-line prefer-const
	let session: positron.DataExplorerRpcSession | undefined;
	const dataExplorerHandler = new DataExplorerRpcHandler(db, event => session?.sendUiEvent(event), context.globalStorageUri.fsPath);
	session = positron.dataExplorer.registerRpcHandler('positron-duckdb', {
		handleRpc: (request) => dataExplorerHandler.handleRequest(request as DataExplorerRpc),
		// Notified when a data explorer closes so the worker can idle-shut-down
		// once the last one is gone.
		closeDataset: (datasetId) => dataExplorerHandler.closeDataset(datasetId)
	});
	context.subscriptions.push(dataExplorerHandler, session);
}

export function deactivate() { }
