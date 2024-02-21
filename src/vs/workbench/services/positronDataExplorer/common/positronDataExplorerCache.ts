/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { TableData, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

export interface DataFetchRange {
	/// Start index is inclusive
	rowStartIndex: number;

	/// End index is exclusive
	rowEndIndex: number;

	/// Start index is inclusive
	columnStartIndex: number;

	/// End index is exclusive
	columnEndIndex: number;
}

export interface FetchedData extends DataFetchRange {
	data: TableData;
}

export interface SchemaFetchRange {
	/// Start index is inclusive
	startIndex: number;

	/// End index is exclusive
	endIndex: number;
}

export interface FetchedSchema extends SchemaFetchRange {
	schema: TableSchema;
}

// Debounces requests and caches results in a simple LRU cache
abstract class FetchCache<RangeType, ResultType extends RangeType> {
	private _cache: Array<{ value: ResultType; lastUsedTime: number }> = [];

	private _cacheSize: number = 0;

	private _maxCacheSize: number = 100_000;

	// We'll try a 100ms debounce timeout to start
	private _debounceMillis = 100;

	// If we need to fetch more data and there is already a pending fetch,
	// then we queue the next fetch with setTimeout, which will be immediately canceled
	// and superseded by another fetch (e.g. if the user is moving around the waffle
	// really fast).
	private _debounceTimer?: any;

	private _pending?: { range: RangeType; promise: Promise<ResultType> };

	constructor(maxCacheSize: number) {
		this._maxCacheSize = maxCacheSize;
	}

	fetch(range: RangeType): Promise<ResultType> {
		if (this._pending) {
			// If there is a pending fetch, clear any existing timer for a follow up request,
			// and set a new timer
			clearTimeout(this._debounceTimer);

			let deferredResolve: (r: ResultType) => void;
			const deferredPromise: Promise<ResultType> = new Promise(resolve => {
				deferredResolve = resolve;
			});
			this._debounceTimer = setTimeout(async () => {
				const promise = this.cacheRange(range);
				this._pending = { range, promise };
				const result = await promise;
				deferredResolve(result);
			}, this._debounceMillis);

			return deferredPromise;
		} else {
			this._pending = { range, promise: this.cacheRange(range) };
			return this._pending.promise;
		}
	}

	private async cacheRange(range: RangeType): Promise<ResultType> {
		// Determine if the range is contained in any cached result
		for (const cachedItem of this._cache) {
			if (this.rangeIncludes(range, cachedItem.value)) {
				cachedItem.lastUsedTime = new Date().getTime();
				return cachedItem.value;
			}
		}

		const value = await this.doFetch(range);

		const currentTime = new Date().getTime();
		const result = { value, lastUsedTime: currentTime };

		const valueSize = this.getRangeTotalSize(result.value);
		this.trimCache(valueSize);
		this._cacheSize += valueSize;
		this._cache.push(result);

		return result.value;
	}

	abstract getRangeTotalSize(v: RangeType): number;
	abstract rangeIncludes(range: RangeType, inRange: RangeType): boolean;
	abstract doFetch(range: RangeType): Promise<ResultType>;

	clear() {
		this._cache = [];
		this._cacheSize = 0;
	}

	currentCacheSize(): number {
		return this._cacheSize;
	}

	setMaxCacheSize(newCacheSize: number) {
		this._maxCacheSize = newCacheSize;
		this.trimCache();
	}

	private trimCache(additionalSize: number = 0) {
		while (this._cacheSize + additionalSize > this._maxCacheSize &&
			this._cache.length > 0) {
			// Evict results from cache based on recency of use
			let oldest = 0;
			for (let i = 1; i < this._cache.length; ++i) {
				if (this._cache[i].lastUsedTime < this._cache[oldest].lastUsedTime) {
					oldest = i;
				}
			}
			this._cacheSize -= this.getRangeTotalSize(this._cache[oldest].value);
			this._cache.splice(oldest, 1);
		}
	}
}

type DataFetchFunc = (req: DataFetchRange) => Promise<TableData>;
type SchemaFetchFunc = (req: SchemaFetchRange) => Promise<TableSchema>;

export class TableDataCache extends FetchCache<DataFetchRange, FetchedData> {
	private readonly DATA_ROW_WINDOW = 100;
	private readonly DATA_COLUMN_WINDOW = 10;

	private _fetchFunc;
	private _tableShape;

	constructor(tableShape: [number, number], fetchFunc: DataFetchFunc,
		maxCacheSize: number = 100_000) {
		super(maxCacheSize);
		this._tableShape = tableShape;
		this._fetchFunc = fetchFunc;
	}

	getRangeTotalSize(range: DataFetchRange): number {
		return ((range.columnEndIndex - range.columnStartIndex) *
			(range.rowEndIndex - range.rowStartIndex));
	}

	rangeIncludes(range: DataFetchRange, inRange: DataFetchRange): boolean {
		return (range.rowStartIndex >= inRange.rowStartIndex &&
			range.rowEndIndex <= inRange.rowEndIndex &&
			range.columnStartIndex >= inRange.columnStartIndex &&
			range.columnEndIndex <= inRange.columnEndIndex);
	}

	async doFetch(range: DataFetchRange): Promise<FetchedData> {
		range = structuredClone(range);

		range.rowStartIndex = Math.max(0, range.rowStartIndex - this.DATA_ROW_WINDOW);
		range.rowEndIndex = Math.min(this._tableShape[0],
			range.rowEndIndex + this.DATA_ROW_WINDOW);

		range.columnStartIndex = Math.max(0, range.columnStartIndex - this.DATA_COLUMN_WINDOW);
		range.columnEndIndex = Math.min(this._tableShape[1],
			range.columnEndIndex + this.DATA_COLUMN_WINDOW);

		const data = await this._fetchFunc(range);

		// Set this based on actual number of columns returned
		range.columnEndIndex = range.columnStartIndex + data.columns.length;

		if (data.columns.length === 0) {
			// No data was returned
			range.rowEndIndex = range.rowStartIndex;
		} else {
			range.rowEndIndex = range.rowStartIndex + data.columns[0].length;
		}

		return { data, ...range };
	}
}

export class TableSchemaCache extends FetchCache<SchemaFetchRange, FetchedSchema> {
	private readonly SCHEMA_WINDOW = 50;

	private _fetchFunc;
	public tableShape: [number, number];

	constructor(fetchFunc: SchemaFetchFunc, maxCacheSize: number = 10_000) {
		super(maxCacheSize);
		this.tableShape = [0, 0];
		this._fetchFunc = fetchFunc;
	}

	async initialize() {
		const init_schema = await this._fetchFunc({ startIndex: 0, endIndex: 0 });
		this.tableShape = [init_schema.num_rows, init_schema.total_num_columns];
	}

	getRangeTotalSize(range: SchemaFetchRange): number {
		return range.endIndex - range.startIndex;
	}

	rangeIncludes(range: SchemaFetchRange, inRange: SchemaFetchRange): boolean {
		return (range.startIndex >= inRange.startIndex &&
			range.endIndex <= inRange.endIndex);
	}

	async doFetch(range: SchemaFetchRange): Promise<FetchedSchema> {
		range = structuredClone(range);

		range.startIndex = Math.max(0, range.startIndex - this.SCHEMA_WINDOW);
		range.endIndex = Math.min(this.tableShape[1], range.endIndex + this.SCHEMA_WINDOW);

		const schema = await this._fetchFunc(range);

		// Set this based on actual number of columns returned
		range.endIndex = range.endIndex + schema.columns.length;

		if (schema.columns.length === 0) {
			// No schema was returned
			range.endIndex = range.startIndex;
		} else {
			range.endIndex = range.startIndex + schema.columns.length;
		}

		return { schema, ...range };
	}
}
