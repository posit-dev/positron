/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	FilterComparison,
	FilterComparisonOp,
	FilterSetMembership,
	FilterTextSearch,
	RowFilterType,
	TextSearchType
} from '../../../languageRuntime/common/positronDataExplorerComm.js';
import * as mocks from "../../../positronDataExplorer/common/positronDataExplorerMocks.js";

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
		const schema = mocks.getTableSchema(1000, 10);

		const filter = mocks.getCompareFilter(schema.columns[2], FilterComparisonOp.Gt, '1234');
		assert.equal(filter.filter_type, RowFilterType.Compare);
		assert.equal(filter.column_schema.column_index, 2);

		const params = filter.params as FilterComparison;

		assert.equal(params.op, FilterComparisonOp.Gt);
		assert.equal(params.value, '1234');
	});

	test('Test getIsNullFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);
		let filter = mocks.getIsNullFilter(schema.columns[3]);
		assert.equal(filter.column_schema.column_index, 3);
		assert.equal(filter.filter_type, RowFilterType.IsNull);

		filter = mocks.getNotNullFilter(schema.columns[3]);
		assert.equal(filter.filter_type, RowFilterType.NotNull);
	});

	test('Test getTextSearchFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);
		const filter = mocks.getTextSearchFilter(schema.columns[5], 'needle',
			TextSearchType.Contains, false);
		assert.equal(filter.column_schema.column_index, 5);
		assert.equal(filter.filter_type, RowFilterType.Search);

		const params = filter.params as FilterTextSearch;

		assert.equal(params.term, 'needle');
		assert.equal(params.search_type, TextSearchType.Contains);
		assert.equal(params.case_sensitive, false);
	});

	test('Test getSetMemberFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);
		const set_values = ['need1', 'need2'];
		const filter = mocks.getSetMemberFilter(schema.columns[6], set_values, true);
		assert.equal(filter.column_schema.column_index, 6);
		assert.equal(filter.filter_type, RowFilterType.SetMembership);

		const params = filter.params as FilterSetMembership;

		assert.equal(params.values, set_values);
		assert.equal(params.inclusive, true);
	});

});
