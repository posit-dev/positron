/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { TableData } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';

export interface FetchRange {
	/// Start index is inclusive
	rowStartIndex: number;

	/// End index is exclusive
	rowEndIndex: number;

	/// Start index is inclusive
	columnStartIndex: number;

	/// End index is exclusive
	columnEndIndex: number;
}

export interface FetchResult extends FetchRange {
	data: TableData;
	lastUsedTime: number;
}

type FetchFunc = (req: FetchRange) => Promise<TableData>;

export class PositronDataToolCache {
	private readonly ROW_CACHE_WINDOW = 100;
	private readonly COLUMN_CACHE_WINDOW = 10;

	private _tableShape: [number, number];

	private _cachedResults: Array<FetchResult> = [];

	// Number of cells cached
	private _cacheSize: number = 0;

	// We cache up to this many cells. After that, we start dropping the
	// least-recently used cached data
	private _maxCacheSize: number = 100_000;

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

	constructor(tableShape: [number, number], fetcher: FetchFunc) {
		this._tableShape = tableShape;
		this._fetcher = fetcher;
	}

	public static getTotalCells(range: FetchRange) {
		return ((range.columnEndIndex - range.columnStartIndex) *
			(range.rowEndIndex - range.rowStartIndex));
	}

	public static rangeIncludes(range: FetchRange, inRange: FetchRange) {
		return (range.rowStartIndex >= inRange.rowStartIndex &&
			range.rowEndIndex <= inRange.rowEndIndex &&
			range.columnStartIndex >= inRange.columnStartIndex &&
			range.columnEndIndex <= inRange.columnEndIndex);
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
			if (PositronDataToolCache.rangeIncludes(range, cachedResult)) {
				cachedResult.lastUsedTime = new Date().getTime();
				return cachedResult;
			}
		}

		// See if the range is contained in any of the cached data
		range = structuredClone(range);

		range.rowStartIndex = Math.max(0, range.rowStartIndex - this.ROW_CACHE_WINDOW);
		range.rowEndIndex = Math.min(this._tableShape[0],
			range.rowEndIndex + this.ROW_CACHE_WINDOW);

		range.columnStartIndex = Math.max(0, range.columnStartIndex - this.COLUMN_CACHE_WINDOW);
		range.columnEndIndex = Math.min(this._tableShape[1],
			range.columnEndIndex + this.COLUMN_CACHE_WINDOW);

		const data = await this._fetcher(range);

		// Set this based on actual number of columns returned
		range.columnEndIndex = range.columnStartIndex + data.columns.length;

		if (data.columns.length === 0) {
			// No data was returned, so set numRows to 0
			range.rowEndIndex = range.rowStartIndex;
		} else {
			range.rowEndIndex = range.rowStartIndex + data.columns[0].length;
		}

		const currentTime = new Date().getTime();
		const result: FetchResult = { data, lastUsedTime: currentTime, ...range };

		const numCachedCells = PositronDataToolCache.getTotalCells(range);
		this.trimCache(numCachedCells);
		this._cacheSize += numCachedCells;
		this._cachedResults.push(result);

		return result;
	}

	clear() {
		this._cachedResults = [];
		this._cacheSize = 0;
	}

	currentCacheSize(): number {
		return this._cacheSize;
	}

	setMaxCacheSize(newCacheSize: number) {
		this._maxCacheSize = newCacheSize;
		this.trimCache();
	}

	private trimCache(additionalCells: number = 0) {
		while (this._cacheSize + additionalCells > this._maxCacheSize &&
			this._cachedResults.length > 0) {
			// Evict results from cache based on recency of use
			let oldest = 0;
			for (let i = 1; i < this._cachedResults.length; ++i) {
				if (this._cachedResults[i].lastUsedTime < this._cachedResults[oldest].lastUsedTime) {
					oldest = i;
				}
			}
			this._cacheSize -= PositronDataToolCache.getTotalCells(this._cachedResults[oldest]);
			this._cachedResults.splice(oldest, 1);
		}
	}
}
