/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { ensureNoLeakedDisposables } from '../../../../../base/test/common/vitestUtils.js';
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
describe('DataExplorerMocks', () => {
	ensureNoLeakedDisposables();

	it('Test getTableSchema', () => {
		const schema = mocks.getTableSchema(1000, 10000);
		expect(schema.columns.length).toBe(10000);
	});

	it('Test getExampleTableData', () => {
		const schema = mocks.getTableSchema(1000, 10000);

		const tableShape: [number, number] = [1000, 10000];

		let data = mocks.getExampleTableData(tableShape, schema, 0, 100, [0, 1, 2, 3, 4]);
		expect(data.columns.length).toBe(5);
		expect(data.columns[0].length).toBe(100);

		data = mocks.getExampleTableData(tableShape, schema, 999, 100, [999]);
		expect(data.columns.length).toBe(1);
		expect(data.columns[0].length).toBe(1);
		data = mocks.getExampleTableData(tableShape, schema, 1000, 100, []);
		expect(data.columns.length).toBe(0);
	});

	it('Test getCompareFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);

		const filter = mocks.getCompareFilter(schema.columns[2], FilterComparisonOp.Gt, '1234');
		expect(filter.filter_type).toBe(RowFilterType.Compare);
		expect(filter.column_schema.column_index).toBe(2);

		const params = filter.params as FilterComparison;

		expect(params.op).toBe(FilterComparisonOp.Gt);
		expect(params.value).toBe('1234');
	});

	it('Test getIsNullFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);
		let filter = mocks.getIsNullFilter(schema.columns[3]);
		expect(filter.column_schema.column_index).toBe(3);
		expect(filter.filter_type).toBe(RowFilterType.IsNull);

		filter = mocks.getNotNullFilter(schema.columns[3]);
		expect(filter.filter_type).toBe(RowFilterType.NotNull);
	});

	it('Test getTextSearchFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);
		const filter = mocks.getTextSearchFilter(schema.columns[5], 'needle',
			TextSearchType.Contains, false);
		expect(filter.column_schema.column_index).toBe(5);
		expect(filter.filter_type).toBe(RowFilterType.Search);

		const params = filter.params as FilterTextSearch;

		expect(params.term).toBe('needle');
		expect(params.search_type).toBe(TextSearchType.Contains);
		expect(params.case_sensitive).toBe(false);
	});

	it('Test getSetMemberFilter', () => {
		const schema = mocks.getTableSchema(1000, 10);
		const set_values = ['need1', 'need2'];
		const filter = mocks.getSetMemberFilter(schema.columns[6], set_values, true);
		expect(filter.column_schema.column_index).toBe(6);
		expect(filter.filter_type).toBe(RowFilterType.SetMembership);

		const params = filter.params as FilterSetMembership;

		expect(params.values).toBe(set_values);
		expect(params.inclusive).toBe(true);
	});

});
