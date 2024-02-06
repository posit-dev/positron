/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IColumnSortKey } from 'vs/base/browser/ui/dataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/dataGrid/classes/dataGridInstance';
import { PositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/positronDataToolColumn';
import { DataToolClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataToolClient';
import { ColumnSortKey, TableData, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';

interface FetchRange {
	/// Start index is inclusive
	rowStartIndex: number;

	/// End index is exclusive
	rowEndIndex: number;

	/// Start index is inclusive
	columnStartIndex: number;

	/// End index is exclusive
	columnEndIndex: number;
}

function rangeIncludes(range: FetchRange, inRange: FetchRange) {
	return (range.rowStartIndex >= inRange.rowStartIndex &&
		range.rowEndIndex <= inRange.rowEndIndex &&
		range.columnStartIndex >= inRange.columnStartIndex &&
		range.columnEndIndex <= inRange.columnEndIndex);
}

interface FetchResult extends FetchRange {
	data: TableData;
	lastUsedTime: number;
}

type FetchFunc = (req: FetchRange) => Promise<TableData>;

export class PositronDataToolFetchManager {
	private readonly ROW_CACHE_WINDOW = 100;
	private readonly COLUMN_CACHE_WINDOW = 10;

	private _cachedResults: Array<FetchResult> = [];

	// Number of cells cached
	private _cacheSize: number = 0;

	// We cache up to this many cells. After that, we start dropping the
	// least-recently used cached data
	private readonly MAX_NUM_CACHED_CELLS = 100_000;

	// The active fetch, so we can avoid spamming the backend with too many requests
	private _pendingFetch?: { range: FetchRange; promise: Promise<FetchResult> };

	// If we need to fetch more data and there is already a pending fetch,
	// then we queue the next fetch with setTimeout, which will be immediately canceled
	// and superseded by another fetch (e.g. if the user is moving around the waffle
	// really fast).
	private _debounceTimer?: any;

	// We'll try a 100ms debounce timeout to start
	private _debounceMillis = 100;

	private readonly _fetcher: FetchFunc;

	constructor(fetcher: FetchFunc) {
		this._fetcher = fetcher;
	}

	/// Execute fetch request and handle throttling requests so that we do not spam the
	/// backend with tons of requests if the user is moving around the waffle quickly.
	fetch(range: FetchRange): Promise<FetchResult> {
		if (this._pendingFetch) {
			// If there is a pending fetch, clear any existing timer for a follow up request,
			// and set a new timer
			clearTimeout(this._debounceTimer);

			let deferredResolve: (r: FetchResult) => void;
			const deferredPromise: Promise<FetchResult> = new Promise(resolve => {
				deferredResolve = resolve;
			});
			this._debounceTimer = setTimeout(async () => {
				const promise = this.cacheRange(range);
				this._pendingFetch = { range, promise };
				const result = await promise;
				deferredResolve(result);
			}, this._debounceMillis);

			return deferredPromise;
		} else {
			this._pendingFetch = { range, promise: this.cacheRange(range) };
			return this._pendingFetch.promise;
		}
	}

	private async cacheRange(range: FetchRange): Promise<FetchResult> {
		// Determine if the range is contained in any cached result
		for (const cachedResult of this._cachedResults) {
			if (rangeIncludes(range, cachedResult)) {
				return cachedResult;
			}
		}

		// See if the range is contained in any of the cached data
		const cacheRange = structuredClone(range);

		cacheRange.rowStartIndex = Math.max(0, cacheRange.rowStartIndex - this.ROW_CACHE_WINDOW);
		cacheRange.rowEndIndex += this.ROW_CACHE_WINDOW;

		cacheRange.columnStartIndex = Math.max(0, cacheRange.columnStartIndex - this.COLUMN_CACHE_WINDOW);
		cacheRange.columnEndIndex += this.COLUMN_CACHE_WINDOW;

		const data = await this._fetcher(cacheRange);

		// Set this based on actual number of columns returned
		cacheRange.columnEndIndex = cacheRange.columnStartIndex + data.columns.length;

		if (data.columns.length === 0) {
			// No data was returned, so set numRows to 0
			range.rowEndIndex = range.rowStartIndex;
		} else {
			range.rowEndIndex = range.rowStartIndex + data.columns[0].length;
		}

		const lastUsedTime = new Date().getTime();
		const result: FetchResult = { data, lastUsedTime, ...cacheRange };

		const getTotalCells = (range: FetchRange) => {
			return ((range.columnEndIndex - range.columnStartIndex) *
				(range.rowEndIndex - range.rowStartIndex));
		};

		this._cacheSize += getTotalCells(cacheRange);

		while (this._cacheSize > this.MAX_NUM_CACHED_CELLS) {
			// Evict results from cache based on recency of use
			let oldest = 0;
			for (let i = 1; i < this._cachedResults.length; ++i) {
				if (this._cachedResults[i].lastUsedTime < this._cachedResults[oldest].lastUsedTime) {
					oldest = i;
				}
			}
			this._cacheSize -= getTotalCells(this._cachedResults[oldest]);
			this._cachedResults.splice(oldest, 1);
		}
		this._cachedResults.push(result);

		return result;
	}

	clear() {
		this._cachedResults = [];
	}
}

/**
 * PositronDataToolDataGridInstance class.
 */
export class PositronDataToolDataGridInstance extends DataGridInstance {
	/**
	 * Gets the data tool client instance.
	 */
	private readonly _dataToolClientInstance: DataToolClientInstance;

	private _tableSchema?: TableSchema;

	private _fetchManager: PositronDataToolFetchManager;

	private _lastFetchResult?: FetchResult;

	constructor(dataToolClientInstance: DataToolClientInstance) {
		// Call the base class's constructor.
		super({
			columnHeadersHeight: 34,
			rowHeadersWidth: 55,
			minimumColumnWidth: 100,
			scrollbarWidth: 14
		});

		// Set the data tool client instance.
		this._dataToolClientInstance = dataToolClientInstance;

		this._fetchManager = new PositronDataToolFetchManager(async (req: FetchRange) => {
			const start = new Date().getTime();

			// Build the column indices to fetch.
			const columnIndices: number[] = [];
			for (let i = req.columnStartIndex; i < req.columnEndIndex; i++) {
				columnIndices.push(i);
			}

			const data = await this._dataToolClientInstance.getDataValues(
				req.rowStartIndex,
				req.rowEndIndex - req.rowStartIndex,
				columnIndices
			);
			const end = new Date().getTime();
			console.log(`Fetching data took ${end - start}ms`);
			return data;
		});
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		if (!this._tableSchema) {
			return 0;
		} else {
			return this._tableSchema?.num_rows;
		}
	}

	/**
	 *
	 */
	initialize() {
		this._dataToolClientInstance.getSchema().then(tableSchema => {

			console.log(`++++++++++ Schema returned with ${tableSchema.columns.length} columns`);

			this._tableSchema = tableSchema;

			const columns: PositronDataToolColumn[] = [];
			for (let i = 0; i < tableSchema.columns.length; i++) {
				columns.push(new PositronDataToolColumn(tableSchema.columns[i]));
			}

			this.setColumns(columns);

			// Fetch data.
			this.fetchData();
		}).catch(x => {

		});
	}

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Set the sort columns.
		await this._dataToolClientInstance.setSortColumns(columnSorts.map(columnSort => (
			{
				column_index: columnSort.columnIndex,
				ascending: columnSort.ascending
			} satisfies ColumnSortKey
		)));

		// Clear the data cache
		this._fetchManager.clear();
		this._lastFetchResult = undefined;

		// Refetch data.
		await this.doFetchData();
	}

	private async doFetchData(): Promise<void> {
		// If the table schema hasn't loaded, we cannot fetch data.
		if (!this._tableSchema) {
			return;
		}

		const rangeToFetch: FetchRange = {
			rowStartIndex: this.firstRowIndex,
			rowEndIndex: this.firstRowIndex + this.visibleRows,
			columnStartIndex: this.firstColumnIndex,
			columnEndIndex: this.firstColumnIndex + this.visibleColumns
		};

		if (this.needToFetch(rangeToFetch)) {
			this._lastFetchResult = await this._fetchManager.fetch(rangeToFetch);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	private needToFetch(range: FetchRange) {
		if (!this._lastFetchResult) {
			return true;
		} else {
			return !rangeIncludes(range, this._lastFetchResult);
		}
	}

	fetchData() {
		this.doFetchData().then(() => {

		}).catch(x => {
			console.log(x);
		});
	}

	/**
	 * Gets a row label.
	 * @param rowIndex The row index.
	 * @returns The row label.
	 */
	rowLabel(rowIndex: number) {
		// If there isn't any cached data, return undefined.
		if (!this._lastFetchResult) {
			return undefined;
		}

		// If the row isn't cached, return undefined.
		if (rowIndex < this._lastFetchResult.rowStartIndex ||
			rowIndex > this._lastFetchResult.rowEndIndex
		) {
			return undefined;
		}

		// If there are no row labels, return the row index.
		if (!this._lastFetchResult.data.row_labels) {
			return `${rowIndex + 1}`;
		}

		// Calculate the cached row index.
		const cachedRowIndex = rowIndex - this._lastFetchResult.rowStartIndex;

		// Return the cached row label.
		return this._lastFetchResult.data.row_labels[0][cachedRowIndex];
	}

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): string | undefined {
		// If there isn't any cached data, return undefined.
		if (!this._lastFetchResult) {
			return undefined;
		}

		// If the cell isn't cached, return undefined.
		if (rowIndex < this._lastFetchResult.rowStartIndex ||
			rowIndex >= this._lastFetchResult.rowEndIndex ||
			columnIndex < this._lastFetchResult.columnStartIndex ||
			columnIndex >= this._lastFetchResult.columnEndIndex
		) {
			return undefined;
		}

		// Calculate the cache indices.
		const cachedRowIndex = rowIndex - this._lastFetchResult.rowStartIndex;
		const cachedColIndex = columnIndex - this._lastFetchResult.columnStartIndex;

		// Return the cached value.
		return this._lastFetchResult.data.columns[cachedColIndex][cachedRowIndex];
	}
}
