/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { TableSchema } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import {
	DataFetchRange,
	SchemaFetchRange,
	TableDataCache,
	TableSchemaCache
} from "../../../positronDataExplorer/common/positronDataExplorerCache.js";
import * as mocks from "../../../positronDataExplorer/common/positronDataExplorerMocks.js";


class MockDataCache extends TableDataCache {
	private schema: TableSchema;

	constructor(tableShape: [number, number], schema: TableSchema) {
		super(tableShape, async (req: DataFetchRange) => {
			// Build the column indices to fetch.
			const columnIndices: number[] = [];
			for (let i = req.columnStartIndex; i < req.columnEndIndex; i++) {
				columnIndices.push(i);
			}
			return mocks.getExampleTableData(tableShape, this.schema,
				req.rowStartIndex,
				req.rowEndIndex - req.rowStartIndex,
				columnIndices
			);
		});

		this.schema = schema;
	}
}

class MockSchemaCache extends TableSchemaCache {
	private schema: TableSchema;

	constructor(tableShape: [number, number], schema: TableSchema) {
		super(tableShape, async (req: SchemaFetchRange) => {
			return {
				columns: this.schema.columns.slice(req.startIndex, req.endIndex)
			};
		});
		this.schema = schema;
	}
}

/**
 * Testing internal business logic
 */
/// <reference types="vitest/globals" />
describe('DataExplorerInternals', () => {

	it('Data cache works correctly', async () => {
		const numRows = 100000;
		const numColumns = 1000;
		const schema = mocks.getTableSchema(numRows, numColumns);
		const fetcher = new MockDataCache([numRows, numColumns], schema);

		const range: DataFetchRange = {
			rowStartIndex: 100,
			rowEndIndex: 200,
			columnStartIndex: 100,
			columnEndIndex: 120
		};

		const data = await fetcher.fetch(range);
		expect(data.rowStartIndex).toBe(range.rowStartIndex - 100);
		expect(data.rowEndIndex).toBe(range.rowEndIndex + 100);
		expect(data.columnStartIndex).toBe(range.columnStartIndex - 10);
		expect(data.columnEndIndex).toBe(range.columnEndIndex + 10);

		const cacheSize = fetcher.currentCacheSize();
		expect(cacheSize).toBe(fetcher.getRangeTotalSize(data));

		let sameData = await fetcher.fetch(range);
		expect(data).toBe(sameData);

		// Fetch another range (overlapping, even), and make sure that our fetches
		// are as expected
		const range2 = structuredClone(range);
		range2.rowStartIndex = 200;
		range2.rowEndIndex = 400;
		const data2 = await fetcher.fetch(range2);

		expect(fetcher.currentCacheSize()).toBe(cacheSize + fetcher.getRangeTotalSize(data2));

		sameData = await fetcher.fetch(range);
		expect(data).toBe(sameData);

		sameData = await fetcher.fetch(range2);
		expect(data2).toBe(sameData);

		// Now, we'll set the data cache size lower and make a large request to show that we
		// evict the first two change
		expect(fetcher.currentCacheSize() < 100000).toBeTruthy();
		fetcher.setMaxCacheSize(10000);

		const largeRange: DataFetchRange = {
			rowStartIndex: 0,
			rowEndIndex: 2000,
			columnStartIndex: 0,
			columnEndIndex: 10
		};
		const largeData = await fetcher.fetch(largeRange);

		// largeData is now the only thing cached
		expect(fetcher.currentCacheSize()).toBe(fetcher.getRangeTotalSize(largeData));

		// Was cached even though it was big
		sameData = await fetcher.fetch(largeRange);
		expect(largeData).toBe(sameData);

		fetcher.clear();
		expect(fetcher.currentCacheSize()).toBe(0);
	});

	it('Schema cache works correctly', async () => {
		const numRows = 100000;
		const numColumns = 1000;
		const schema = mocks.getTableSchema(numRows, numColumns);
		const fetcher = new MockSchemaCache([numRows, numColumns], schema);

		const range: SchemaFetchRange = {
			startIndex: 50,
			endIndex: 100
		};

		const result = await fetcher.fetch(range);
		expect(result.startIndex).toBe(0);
		expect(result.endIndex).toBe(150);
		expect(result.schema.columns.length).toBe(150);

		expect(result.schema.columns).toEqual(schema.columns.slice(0, 150));
		expect(fetcher.currentCacheSize()).toBe(150);

		range.startIndex = 0;
		range.endIndex = 50;
		const result2 = await fetcher.fetch(range);

		// Same object
		expect(result2).toBe(result);

		// Overlapping...
		range.startIndex = 149;
		range.endIndex = 151;
		const result3 = await fetcher.fetch(range);
		expect(result3.schema.columns).toEqual(schema.columns.slice(99, 201));
		expect(fetcher.currentCacheSize()).toBe(252);

		// Trimming cache works
		fetcher.setMaxCacheSize(result3.endIndex - result3.startIndex);
		expect(fetcher.currentCacheSize()).toBe(102);
		const result4 = await fetcher.fetch(range);
		expect(result4).toBe(result3);
	});
});
