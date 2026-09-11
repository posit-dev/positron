/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BackendState, ColumnSortKey, FilterBetween, FilterComparison, FilterSetMembership,
	FilterTextSearch, RowFilter, RowFilterCondition, RowFilterType, TableSchema,
} from '../../languageRuntime/common/positronDataExplorerComm.js';
import {
	IDataImportRowFilter, IDataImportSortKey, IDataImportView,
} from './positronDataImporterRegistry.js';

/**
 * Builds the importer-facing view of a Data Explorer's current filters and sorts from its
 * wire-shaped backend state. Row filters the backend marked invalid are excluded, because they
 * are not applied to the on-screen data either. Sort keys name columns by index on the wire; the
 * generated code operates on the loaded dataframe, where names are the only stable handle, so
 * they are resolved through the schema here rather than by each generator.
 *
 * @param state The filter and sort arrays from the cached backend state.
 * @param getSchema Resolves absolute column indexes to their schemas.
 * @returns The view, or undefined when there is nothing in it (nothing to offer a checkbox for), or
 * when a sort key cannot be named (offering filters without the sort would silently reorder data).
 */
export async function buildDataImportView(
	state: Pick<BackendState, 'row_filters' | 'sort_keys'>,
	getSchema: (columnIndices: number[]) => Promise<TableSchema>
): Promise<IDataImportView | undefined> {
	const rowFilters = state.row_filters
		.filter(filter => filter.is_valid !== false)
		.map(toImportRowFilter);
	const sortKeys = await resolveSortKeys(state.sort_keys, getSchema);

	if (sortKeys === undefined) {
		// getSchema answers with an empty schema when the backend is disconnected or the request
		// fails, so a name could not be found for every sort key. Reproducing the filters without
		// the sort would hand back differently ordered data with nothing saying so; offer no view.
		return undefined;
	}
	if (rowFilters.length === 0 && sortKeys.length === 0) {
		return undefined;
	}
	return { rowFilters, sortKeys };
}

function toImportRowFilter(filter: RowFilter): IDataImportRowFilter {
	const base = {
		columnName: filter.column_schema.column_name,
		columnType: filter.column_schema.type_display as string,
		condition: filter.condition === RowFilterCondition.Or ? 'or' as const : 'and' as const,
	};
	switch (filter.filter_type) {
		case RowFilterType.Between:
		case RowFilterType.NotBetween: {
			const params = filter.params as FilterBetween;
			return {
				...base,
				filterType: filter.filter_type === RowFilterType.Between ? 'between' : 'not_between',
				leftValue: params.left_value,
				rightValue: params.right_value,
			};
		}
		case RowFilterType.Compare: {
			const params = filter.params as FilterComparison;
			return { ...base, filterType: 'compare', op: params.op, value: params.value };
		}
		case RowFilterType.Search: {
			const params = filter.params as FilterTextSearch;
			return {
				...base,
				filterType: 'search',
				searchType: params.search_type,
				term: params.term,
				caseSensitive: params.case_sensitive,
			};
		}
		case RowFilterType.SetMembership: {
			const params = filter.params as FilterSetMembership;
			return { ...base, filterType: 'set_membership', values: params.values, inclusive: params.inclusive };
		}
		case RowFilterType.IsEmpty:
			return { ...base, filterType: 'is_empty' };
		case RowFilterType.NotEmpty:
			return { ...base, filterType: 'not_empty' };
		case RowFilterType.IsNull:
			return { ...base, filterType: 'is_null' };
		case RowFilterType.NotNull:
			return { ...base, filterType: 'not_null' };
		case RowFilterType.IsTrue:
			return { ...base, filterType: 'is_true' };
		case RowFilterType.IsFalse:
			return { ...base, filterType: 'is_false' };
	}
}

/** Names each sort key through the schema. Undefined means one of them could not be named. */
async function resolveSortKeys(
	sortKeys: ColumnSortKey[],
	getSchema: (columnIndices: number[]) => Promise<TableSchema>
): Promise<IDataImportSortKey[] | undefined> {
	if (sortKeys.length === 0) {
		return [];
	}
	const schema = await getSchema(sortKeys.map(key => key.column_index));
	const resolved: IDataImportSortKey[] = [];
	for (const key of sortKeys) {
		// A key whose index the schema does not answer for cannot be named, and dropping it would
		// order the imported data differently from the screen with nothing reporting it; fail the
		// whole view instead. This should not happen: the indexes come from the same backend that
		// answers the schema request.
		const column = schema.columns.find(column => column.column_index === key.column_index);
		if (!column) {
			return undefined;
		}
		resolved.push({ columnName: column.column_name, ascending: key.ascending });
	}
	return resolved;
}
