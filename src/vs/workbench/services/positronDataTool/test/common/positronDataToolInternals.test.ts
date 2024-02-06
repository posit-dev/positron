/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';
import {
	FetchRange,
	PositronDataToolCache
} from "vs/workbench/services/positronDataTool/common/positronDataToolCache";
import * as mocks from "vs/workbench/services/positronDataTool/common/positronDataToolMocks";


class MockDataCache extends PositronDataToolCache {
	private schema: TableSchema;

	constructor(tableShape: [number, number], schema: TableSchema) {
		super(tableShape, async (req: FetchRange) => {
			// Build the column indices to fetch.
			const columnIndices: number[] = [];
			for (let i = req.columnStartIndex; i < req.columnEndIndex; i++) {
				columnIndices.push(i);
			}

			const data = mocks.getExampleTableData(this.schema,
				req.rowStartIndex,
				req.rowEndIndex - req.rowStartIndex,
				columnIndices
			);
			return data;
		});

		this.schema = schema;
	}
}

function getTotalCells(range: FetchRange) {
	return ((range.columnEndIndex - range.columnStartIndex) *
		(range.rowEndIndex - range.rowStartIndex));
}

/**
 * Testing internal business logic
 */
suite('DataToolInternals', () => {
	// ensureNoDisposablesAreLeakedInTestSuite();

	test('Fetch caches results correctly', async () => {
		const numRows = 100000;
		const numColumns = 1000;
		const schema = mocks.getTableSchema(numRows, numColumns);
		const fetcher = new MockDataCache([numRows, numColumns], schema);

		const range: FetchRange = {
			rowStartIndex: 100,
			rowEndIndex: 200,
			columnStartIndex: 100,
			columnEndIndex: 120
		};

		const data = await fetcher.fetch(range);
		const timestamp = data.lastUsedTime;
		assert.equal(data.rowStartIndex, range.rowStartIndex - 100);
		assert.equal(data.rowEndIndex, range.rowEndIndex + 100);
		assert.equal(data.columnStartIndex, range.columnStartIndex - 10);
		assert.equal(data.columnEndIndex, range.columnEndIndex + 10);

		const cacheSize = fetcher.currentCacheSize();
		assert.equal(cacheSize, getTotalCells(data));

		let sameData = await fetcher.fetch(range);
		assert.strictEqual(data, sameData);
		// Check the timestamp is updated
		assert.notEqual(timestamp, sameData.lastUsedTime);

		// Fetch another range (overlapping, even), and make sure that our fetches
		// are as expected
		const range2 = structuredClone(range);
		range2.rowStartIndex = 200;
		range2.rowEndIndex = 400;
		const data2 = await fetcher.fetch(range2);

		assert.equal(fetcher.currentCacheSize(), cacheSize + getTotalCells(data2));

		sameData = await fetcher.fetch(range);
		assert.strictEqual(data, sameData);

		sameData = await fetcher.fetch(range2);
		assert.strictEqual(data2, sameData);

		// Now, we'll set the data cache size lower and make a large request to show that we
		// evict the first two change
		assert.ok(fetcher.currentCacheSize() < 100000);
		fetcher.setMaxCacheSize(10000);

		const largeRange: FetchRange = {
			rowStartIndex: 0,
			rowEndIndex: 2000,
			columnStartIndex: 0,
			columnEndIndex: 10
		};
		const largeData = await fetcher.fetch(largeRange);

		// largeData is now the only thing cached
		assert.equal(fetcher.currentCacheSize(), getTotalCells(largeData));

		// Was cached even though it was big
		sameData = await fetcher.fetch(largeRange);
		assert.strictEqual(largeData, sameData);

		fetcher.clear();
		assert.equal(fetcher.currentCacheSize(), 0);
	});
});
