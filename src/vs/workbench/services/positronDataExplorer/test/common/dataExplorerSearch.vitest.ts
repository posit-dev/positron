/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ColumnDisplayType, FilterComparisonOp, RowFilter, RowFilterCondition, RowFilterType, SupportStatus } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { DataCell, DataCellKind } from '../../common/tableDataCache.js';
import { getFormatOptions } from '../../common/positronDataExplorerMocks.js';
import { cellMatchesSearch, findMatchSpan, isGlobalSearchSupported, makeGlobalSearchFilter, numberMatchesSearch, parseSearchTerm, splitRowFilters } from '../../common/dataExplorerSearch.js';

function numeric(term: string) {
	const parsed = parseSearchTerm(term);
	if (parsed.kind !== 'numeric') {
		throw new Error(`${term} is not numeric`);
	}
	return parsed;
}

function cell(formatted: string, kind = DataCellKind.NON_NULL): DataCell {
	return { formatted, kind };
}

describe('parseSearchTerm', () => {
	it.each([
		['3', 3, 0],
		['3.', 3, 0],
		['3.1', 3.1, 1],
		['3.10', 3.1, 2],
		['-3', -3, 0],
		['.5', 0.5, 1],
		['1,234', 1234, 0],
		['1,234.5', 1234.5, 1],
		['+2', 2, 0],
		['  3', 3, 0],
	])('classifies %j as numeric %d with %d decimals', (term, value, decimals) => {
		expect(numeric(term)).toMatchObject({ value, decimals, text: term });
	});

	it.each(['1e3', '1,23', '-', '3 4', '0x10', 'Inf', 'NaN', 'abc'])('classifies %j as text', term => {
		expect(parseSearchTerm(term).kind).toBe('text');
	});

	it('classifies the empty term as none', () => {
		expect(parseSearchTerm('').kind).toBe('none');
	});

	it.each([
		['null', true], ['NA', true], [' None ', true], ['nan', true], ['NaT', true], ['<NA>', true],
		['nu', false], ['n', false], ['nullable', false],
	])('treats %j as a null marker: %s', (term, nullMarker) => {
		expect(parseSearchTerm(term)).toMatchObject({ nullMarker });
	});
});

describe('numberMatchesSearch', () => {
	it.each([
		['3', [3, 3.0, 3.5, 3.999, 2.9999999999], [2.9, 4, -3, 3.9999999999]],
		['3.', [3, 3.5], [4]],
		['3.1', [3.1, 3.14159, 3.19], [3.0999, 3.2, 3]],
		['3.10', [3.10, 3.105], [3.11, 3.1999]],
		['-3', [-3, -3.5, -3.999], [-4, -2.9, 3]],
		['0', [0, 0.5, -0.5, 0.999], [1, -1]],
		['.5', [0.5, 0.55], [0.6, 0.49]],
		['1,234', [1234, 1234.9], [12340, 1233]],
		['+2', [2, 2.5], [3]],
		['3', [], [Infinity, -Infinity, NaN]],
	])('%j matches %j and not %j', (term, matches, nonMatches) => {
		const parsed = numeric(term);
		expect(matches.filter(value => !numberMatchesSearch(value, parsed))).toEqual([]);
		expect(nonMatches.filter(value => numberMatchesSearch(value, parsed))).toEqual([]);
	});
});

describe('cellMatchesSearch', () => {
	const match = (dataCell: DataCell, type: ColumnDisplayType, term: string) =>
		cellMatchesSearch(dataCell, type, parseSearchTerm(term));

	it('matches numeric cells by implied precision, ignoring thousands separators', () => {
		expect([
			match(cell('3.14'), ColumnDisplayType.Floating, '3.1'),
			match(cell('1,234.50'), ColumnDisplayType.Floating, '1,234'),
			match(cell('3'), ColumnDisplayType.Integer, '3.1'),
			match(cell('3'), ColumnDisplayType.Integer, '3.0'),
			match(cell('1000'), ColumnDisplayType.Integer, '1e3'),
			match(cell('-INF', DataCellKind.NEG_INFINITY), ColumnDisplayType.Floating, '-INF'),
		]).toEqual([true, true, false, true, false, false]);
	});

	it('matches text cells by case-insensitive substring of the untrimmed term', () => {
		expect([
			match(cell('xABCx'), ColumnDisplayType.String, 'abc'),
			match(cell('v3.2'), ColumnDisplayType.String, '3'),
			match(cell('a-b'), ColumnDisplayType.String, '-'),
			match(cell('ab'), ColumnDisplayType.String, 'ab '),
			match(cell('2024-01-02'), ColumnDisplayType.Date, '01-0'),
			match(cell('True'), ColumnDisplayType.Boolean, 'true'),
			match(cell('[1, 2]'), ColumnDisplayType.Array, '1'),
		]).toEqual([true, true, true, false, true, true, false]);
	});

	it('matches missing values only for an exact null marker', () => {
		expect([
			match(cell('NA', DataCellKind.NA), ColumnDisplayType.Floating, 'null'),
			match(cell('None', DataCellKind.None), ColumnDisplayType.String, 'None'),
			match(cell('NaN', DataCellKind.NaN), ColumnDisplayType.Floating, 'na'),
			match(cell('NULL', DataCellKind.NULL), ColumnDisplayType.String, 'nu'),
			match(cell('nullable'), ColumnDisplayType.String, 'null'),
		]).toEqual([true, true, true, false, true]);
	});
});

describe('findMatchSpan', () => {
	const span = (text: string, term: string) => findMatchSpan(text, parseSearchTerm(term));

	it('finds the first case-insensitive occurrence', () => {
		expect([span('xAbCabc', 'abc'), span('Stra\u00DFe', 'SSE'), span('\u00DCn\u00EFcode', '\u00FCn\u00EF'), span('abc', 'z'), span('abc', '')])
			.toEqual([[1, 4], undefined, [0, 3], undefined, undefined]);
	});

	it('finds the trimmed numeric term', () => {
		expect(span('3.00', '  3')).toEqual([0, 1]);
	});
});

describe('row filter helpers', () => {
	const columnFilter: RowFilter = {
		filter_id: 'f',
		filter_type: RowFilterType.Compare,
		column_schema: { column_name: 'n', column_index: 0, type_name: 'int', type_display: ColumnDisplayType.Integer },
		condition: RowFilterCondition.And,
		params: { op: FilterComparisonOp.Gt, value: '0' },
	};

	it('splits column filters from the global search', () => {
		const search = makeGlobalSearchFilter('abc', 10, getFormatOptions());
		expect(splitRowFilters([columnFilter, search])).toEqual({ columnFilters: [columnFilter], globalSearch: search });
		expect(search).toMatchObject({ filter_type: RowFilterType.GlobalSearch, params: { term: 'abc', max_cells: 10 } });
		expect(search.column_schema).toBeUndefined();
	});

	it('detects backend support for the global search', () => {
		const features = (supported: SupportStatus) => ({
			support_status: SupportStatus.Supported,
			supports_conditions: SupportStatus.Unsupported,
			supported_types: [{ row_filter_type: RowFilterType.GlobalSearch, support_status: supported }],
		});
		expect([
			isGlobalSearchSupported(features(SupportStatus.Supported)),
			isGlobalSearchSupported(features(SupportStatus.Unsupported)),
			isGlobalSearchSupported({ ...features(SupportStatus.Supported), supported_types: [] }),
			isGlobalSearchSupported(undefined),
		]).toEqual([true, false, false, false]);
	});
});
