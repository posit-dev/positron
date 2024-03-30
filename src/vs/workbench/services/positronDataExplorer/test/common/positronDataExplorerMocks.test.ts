/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import {
	CompareFilterParamsOp,
	RowFilterFilterType,
	SearchFilterParamsType
} from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import * as mocks from "vs/workbench/services/positronDataExplorer/common/positronDataExplorerMocks";

/**
 * Basic smoke tests for debugging the mock functions
 */
suite('DataExplorerMocks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Test getTableSchema', () => {
		const schema = mocks.getTableSchema(1000, 10000);
		assert.equal(schema.columns.length, 10000);
	});

	test('Test getExampleTableData', () => {
		const schema = mocks.getTableSchema(1000, 10000);

		const tableShape: [number, number] = [1000, 10000];

		let data = mocks.getExampleTableData(tableShape, schema, 0, 100, [0, 1, 2, 3, 4]);
		assert.equal(data.columns.length, 5);
		assert.equal(data.columns[0].length, 100);

		data = mocks.getExampleTableData(tableShape, schema, 999, 100, [999]);
		assert.equal(data.columns.length, 1);
		assert.equal(data.columns[0].length, 1);
		data = mocks.getExampleTableData(tableShape, schema, 1000, 100, []);
		assert.equal(data.columns.length, 0);
	});

	test('Test getCompareFilter', () => {
		const filter = mocks.getCompareFilter(2, CompareFilterParamsOp.Gt, '1234');
		assert.equal(filter.filter_type, RowFilterFilterType.Compare);
		assert.equal(filter.column_index, 2);

		const params = filter.compare_params!;

		assert.equal(params.op, CompareFilterParamsOp.Gt);
		assert.equal(params.value, '1234');
	});

	test('Test getIsNullFilter', () => {
		let filter = mocks.getIsNullFilter(3);
		assert.equal(filter.column_index, 3);
		assert.equal(filter.filter_type, RowFilterFilterType.IsNull);

		filter = mocks.getNotNullFilter(3);
		assert.equal(filter.filter_type, RowFilterFilterType.NotNull);
	});

	test('Test getTextSearchFilter', () => {
		const filter = mocks.getTextSearchFilter(5, 'needle',
			SearchFilterParamsType.Contains, false);
		assert.equal(filter.column_index, 5);
		assert.equal(filter.filter_type, RowFilterFilterType.Search);

		const params = filter.search_params!;

		assert.equal(params.term, 'needle');
		assert.equal(params.type, SearchFilterParamsType.Contains);
		assert.equal(params.case_sensitive, false);
	});

	test('Test getSetMemberFilter', () => {
		const set_values = ['need1', 'need2'];
		const filter = mocks.getSetMemberFilter(6, set_values, true);
		assert.equal(filter.column_index, 6);
		assert.equal(filter.filter_type, RowFilterFilterType.SetMembership);

		const params = filter.set_membership_params!;

		assert.equal(params.values, set_values);
		assert.equal(params.inclusive, true);
	});

});
