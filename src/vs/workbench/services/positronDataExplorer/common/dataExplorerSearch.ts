/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeRegExpCharacters } from '../../../../base/common/strings.js';
import { ColumnDisplayType, ColumnSchema, FilterGlobalSearch, RowFilter, RowFilterCondition, RowFilterType, SetRowFiltersFeatures, SupportStatus } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { DataCell, DataCellKind } from './tableDataCache.js';

/**
 * The filter_id of the global search row filter.
 */
const GLOBAL_SEARCH_FILTER_ID = 'global-search';

/**
 * Terms that, trimmed and lowercased, match missing values exactly.
 */
const NULL_MARKERS = new Set(['null', 'na', 'nan', 'none', 'nat', '<na>']);

/**
 * A parsed search term. Text terms match by case-insensitive substring; numeric terms also match
 * numbers that equal the term at its implied precision.
 */
export type SearchTerm =
	| { readonly kind: 'none'; readonly text: '' }
	| { readonly kind: 'text'; readonly text: string; readonly pattern: RegExp; readonly nullMarker: boolean }
	| { readonly kind: 'numeric'; readonly text: string; readonly pattern: RegExp; readonly nullMarker: false; readonly value: number; readonly decimals: number };

/**
 * A row filter that applies to a single column.
 */
export type ColumnRowFilter = RowFilter & { column_schema: ColumnSchema; filter_type: Exclude<RowFilterType, RowFilterType.GlobalSearch> };

/**
 * Parses a search term.
 * @param term The raw search term.
 * @returns The parsed search term.
 */
export function parseSearchTerm(term: string): SearchTerm {
	if (term === '') {
		return { kind: 'none', text: '' };
	}
	const pattern = new RegExp(escapeRegExpCharacters(term), 'i');
	const trimmed = term.trim();
	const number = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
	if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(number)) {
		const decimals = number.includes('.') ? number.length - number.indexOf('.') - 1 : 0;
		return { kind: 'numeric', text: term, pattern, nullMarker: false, value: Number(number), decimals };
	}
	return { kind: 'text', text: term, pattern, nullMarker: NULL_MARKERS.has(trimmed.toLowerCase()) };
}

/**
 * Determines whether a number equals a numeric search term at the term's implied precision, i.e.
 * whether truncating it toward zero at the term's decimals yields the term.
 * @param value The number.
 * @param term The numeric search term.
 */
export function numberMatchesSearch(value: number, term: Extract<SearchTerm, { kind: 'numeric' }>): boolean {
	if (!Number.isFinite(value)) {
		return false;
	}
	const step = 10 ** -term.decimals;
	const eps = step * 1e-9;
	if (term.value > 0) {
		return value >= term.value - eps && value < term.value + step - eps;
	} else if (term.value < 0) {
		return value > term.value - step + eps && value <= term.value + eps;
	} else {
		return value > -step + eps && value < step - eps;
	}
}

/**
 * Determines whether a cell matches a search term from its formatted value. Used when the backend
 * does not report per-cell matches.
 * @param dataCell The data cell.
 * @param typeDisplay The display type of the cell's column.
 * @param term The search term.
 */
export function cellMatchesSearch(dataCell: DataCell, typeDisplay: ColumnDisplayType, term: SearchTerm): boolean {
	if (term.kind === 'none') {
		return false;
	}
	switch (dataCell.kind) {
		case DataCellKind.NON_NULL:
			break;
		case DataCellKind.INFINITY:
		case DataCellKind.NEG_INFINITY:
		case DataCellKind.UNKNOWN:
			return false;
		default:
			return term.nullMarker;
	}
	switch (typeDisplay) {
		case ColumnDisplayType.Floating:
		case ColumnDisplayType.Integer:
		case ColumnDisplayType.Decimal:
			return term.kind === 'numeric' && numberMatchesSearch(Number(dataCell.formatted.replace(/,/g, '')), term);
		case ColumnDisplayType.Array:
		case ColumnDisplayType.Struct:
		case ColumnDisplayType.Unknown:
			return false;
		default:
			return term.pattern.test(dataCell.formatted);
	}
}

/**
 * Finds the first case-insensitive occurrence of a search term in text.
 * @param text The text.
 * @param term The search term.
 * @returns The [start, end) range of the occurrence, or undefined.
 */
export function findMatchSpan(text: string, term: SearchTerm): [number, number] | undefined {
	if (term.kind === 'none') {
		return undefined;
	}
	const match = term.pattern.exec(text) ?? (term.kind === 'numeric' ? new RegExp(escapeRegExpCharacters(term.text.trim()), 'i').exec(text) : null);
	return match ? [match.index, match.index + match[0].length] : undefined;
}

/**
 * Splits row filters into the column filters and the global search filter.
 * @param filters The row filters.
 */
export function splitRowFilters(filters: readonly RowFilter[]): { columnFilters: ColumnRowFilter[]; globalSearch?: RowFilter } {
	return {
		columnFilters: filters.filter((filter): filter is ColumnRowFilter => filter.filter_type !== RowFilterType.GlobalSearch && filter.column_schema !== undefined),
		globalSearch: filters.find(filter => filter.filter_type === RowFilterType.GlobalSearch)
	};
}

/**
 * Gets the term of a global search filter.
 * @param filter The global search filter.
 * @returns The term, or '' if there is no filter.
 */
export function getGlobalSearchTerm(filter: RowFilter | undefined): string {
	return (filter?.params as FilterGlobalSearch | undefined)?.term ?? '';
}

/**
 * Makes a global search row filter.
 * @param term The search term.
 * @param maxCells The maximum number of cells to scan; 0 for no limit.
 */
export function makeGlobalSearchFilter(term: string, maxCells: number): RowFilter {
	return {
		filter_id: GLOBAL_SEARCH_FILTER_ID,
		filter_type: RowFilterType.GlobalSearch,
		condition: RowFilterCondition.And,
		params: { term, max_cells: maxCells }
	};
}

/**
 * Determines whether a backend supports the global search filter.
 * @param features The backend's row filter features.
 */
export function isGlobalSearchSupported(features: SetRowFiltersFeatures | undefined): boolean {
	return features?.support_status === SupportStatus.Supported &&
		features.supported_types.some(type => type.row_filter_type === RowFilterType.GlobalSearch && type.support_status === SupportStatus.Supported);
}
