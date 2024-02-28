/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import {
	DataFetchRange,
	SchemaFetchRange,
	TableDataCache,
	TableSchemaCache
} from "vs/workbench/services/positronDataExplorer/common/positronDataExplorerCache";
import * as mocks from "vs/workbench/services/positronDataExplorer/common/positronDataExplorerMocks";


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
suite('DataExplorerInternals', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Data cache works correctly', async () => {
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
		assert.equal(data.rowStartIndex, range.rowStartIndex - 100);
		assert.equal(data.rowEndIndex, range.rowEndIndex + 100);
		assert.equal(data.columnStartIndex, range.columnStartIndex - 10);
		assert.equal(data.columnEndIndex, range.columnEndIndex + 10);

		const cacheSize = fetcher.currentCacheSize();
		assert.equal(cacheSize, fetcher.getRangeTotalSize(data));

		let sameData = await fetcher.fetch(range);
		assert.strictEqual(data, sameData);

		// Fetch another range (overlapping, even), and make sure that our fetches
		// are as expected
		const range2 = structuredClone(range);
		range2.rowStartIndex = 200;
		range2.rowEndIndex = 400;
		const data2 = await fetcher.fetch(range2);

		assert.equal(fetcher.currentCacheSize(), cacheSize + fetcher.getRangeTotalSize(data2));

		sameData = await fetcher.fetch(range);
		assert.strictEqual(data, sameData);

		sameData = await fetcher.fetch(range2);
		assert.strictEqual(data2, sameData);

		// Now, we'll set the data cache size lower and make a large request to show that we
		// evict the first two change
		assert.ok(fetcher.currentCacheSize() < 100000);
		fetcher.setMaxCacheSize(10000);

		const largeRange: DataFetchRange = {
			rowStartIndex: 0,
			rowEndIndex: 2000,
			columnStartIndex: 0,
			columnEndIndex: 10
		};
		const largeData = await fetcher.fetch(largeRange);

		// largeData is now the only thing cached
		assert.equal(fetcher.currentCacheSize(), fetcher.getRangeTotalSize(largeData));

		// Was cached even though it was big
		sameData = await fetcher.fetch(largeRange);
		assert.strictEqual(largeData, sameData);

		fetcher.clear();
		assert.equal(fetcher.currentCacheSize(), 0);
	});

	test('Schema cache works correctly', async () => {
		const numRows = 100000;
		const numColumns = 1000;
		const schema = mocks.getTableSchema(numRows, numColumns);
		const fetcher = new MockSchemaCache([numRows, numColumns], schema);

		const range: SchemaFetchRange = {
			startIndex: 50,
			endIndex: 100
		};

		const result = await fetcher.fetch(range);
		assert.equal(result.startIndex, 0);
		assert.equal(result.endIndex, 150);
		assert.equal(result.schema.columns.length, 150);

		assert.deepEqual(result.schema.columns, schema.columns.slice(0, 150));
		assert.equal(fetcher.currentCacheSize(), 150);

		range.startIndex = 0;
		range.endIndex = 50;
		const result2 = await fetcher.fetch(range);

		// Same object
		assert.strictEqual(result2, result);

		// Overlapping...
		range.startIndex = 149;
		range.endIndex = 151;
		const result3 = await fetcher.fetch(range);
		assert.deepEqual(result3.schema.columns, schema.columns.slice(99, 201));
		assert.equal(fetcher.currentCacheSize(), 252);

		// Trimming cache works
		fetcher.setMaxCacheSize(result3.endIndex - result3.startIndex);
		assert.equal(fetcher.currentCacheSize(), 102);
		const result4 = await fetcher.fetch(range);
		assert.strictEqual(result4, result3);
	});
});
