/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PackagesSortOrder enum.
 */
export enum PackagesSortOrder {
	NameAsc = 'name-asc',
	NameDesc = 'name-desc',
}

/**
 * PackagesFilter enum. Each value is an independent category filter that can
 * be active simultaneously; the active set is intersected when applied.
 */
export enum PackagesFilter {
	Outdated = 'outdated',
	Attached = 'attached',
}

// Token value <-> PackagesSortOrder mapping used to (de)serialize the
// `@sort:<value>` token in the filter input. Values are the user-facing
// tokens the input accepts; `name` is the implicit default.
const SORT_TOKEN_TO_ORDER: Record<string, PackagesSortOrder> = {
	'name': PackagesSortOrder.NameAsc,
	'name-desc': PackagesSortOrder.NameDesc,
};

const SORT_ORDER_TO_TOKEN: Record<PackagesSortOrder, string> = {
	[PackagesSortOrder.NameAsc]: 'name',
	[PackagesSortOrder.NameDesc]: 'name-desc',
};

// Bare-token grammar for category filters: `@outdated`, `@attached`.
const FILTER_TOKEN_TO_FILTER: Record<string, PackagesFilter> = {
	'outdated': PackagesFilter.Outdated,
	'attached': PackagesFilter.Attached,
};

const FILTER_TO_TOKEN: Record<PackagesFilter, string> = {
	[PackagesFilter.Outdated]: 'outdated',
	[PackagesFilter.Attached]: 'attached',
};

/** Matches `@key` or `@key:value` tokens in the filter input. */
const TOKEN_REGEX = /@(\w+)(?::([\w-]+))?/gi;

/**
 * Parsed representation of the filter input.
 */
export interface ParsedQuery {
	/** Free-text portion, with all `@...` tokens stripped. */
	readonly text: string;
	/** Active sort order. */
	readonly sort: PackagesSortOrder;
	/** Active category filters, in the order they appear in the input. */
	readonly filters: readonly PackagesFilter[];
}

/**
 * Parses the filter input into a free-text portion and the structured tokens
 * it contains. All `@key[:value]` tokens are consumed, even when unrecognized,
 * so unknown tokens don't leak into free-text filtering and produce
 * empty-result-set surprises.
 */
export const parseQuery = (query: string): ParsedQuery => {
	let sort: PackagesSortOrder = PackagesSortOrder.NameAsc;
	const filters: PackagesFilter[] = [];

	const text = query.replace(TOKEN_REGEX, (_match, key: string, value: string | undefined) => {
		const lowerKey = key.toLowerCase();
		if (lowerKey === 'sort' && value !== undefined) {
			const order = SORT_TOKEN_TO_ORDER[value.toLowerCase()];
			if (order !== undefined) {
				sort = order;
			}
		} else if (value === undefined) {
			const filter = FILTER_TOKEN_TO_FILTER[lowerKey];
			if (filter !== undefined && !filters.includes(filter)) {
				filters.push(filter);
			}
		}
		return '';
	}).replace(/\s+/g, ' ').trim();

	return { text, sort, filters };
};

/**
 * Returns a new filter input string with any existing `@sort:` token replaced
 * by the token for the given sort order, preserving surrounding free-text and
 * any other tokens.
 */
export const applySortToQuery = (query: string, sort: PackagesSortOrder): string => {
	const stripped = query.replace(/@sort:[\w-]+/gi, '').replace(/\s+/g, ' ').trim();
	const token = `@sort:${SORT_ORDER_TO_TOKEN[sort]}`;
	return stripped ? `${token} ${stripped}` : token;
};

/**
 * Extracts the active category filters from `query` (in input order, deduped)
 * and returns the residual query with all filter tokens removed. Also strips
 * the legacy `@filter:<value>` syntax so it doesn't linger in the input after
 * a menu interaction.
 */
const extractFilters = (query: string): { filters: PackagesFilter[]; residual: string } => {
	const filters: PackagesFilter[] = [];
	const residual = query
		.replace(/@(\w+)\b(?!:)/gi, (match, name: string) => {
			const filter = FILTER_TOKEN_TO_FILTER[name.toLowerCase()];
			if (filter === undefined) {
				return match;
			}
			if (!filters.includes(filter)) {
				filters.push(filter);
			}
			return '';
		})
		.replace(/@filter:[\w-]+/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
	return { filters, residual };
};

/** Prepends the given filter tokens (in order) to `residual` free-text/sort. */
const rebuildWithFilters = (residual: string, filters: readonly PackagesFilter[]): string => {
	const tokens = filters.map(f => `@${FILTER_TO_TOKEN[f]}`).join(' ');
	if (!tokens) {
		return residual;
	}
	return residual ? `${tokens} ${residual}` : tokens;
};

/**
 * Returns a new filter input string with `filter` added to the active set
 * (no-op if already active). New filters are appended to preserve click order.
 */
export const addFilterToQuery = (query: string, filter: PackagesFilter): string => {
	const { filters, residual } = extractFilters(query);
	const next = filters.includes(filter) ? filters : [...filters, filter];
	return rebuildWithFilters(residual, next);
};

/**
 * Returns a new filter input string with `filter` removed from the active set
 * (no-op if not active). Order of remaining filters is preserved.
 */
export const removeFilterFromQuery = (query: string, filter: PackagesFilter): string => {
	const { filters, residual } = extractFilters(query);
	const next = filters.filter(f => f !== filter);
	return rebuildWithFilters(residual, next);
};

/** Returns a new filter input string with all category filter tokens removed. */
export const clearFiltersFromQuery = (query: string): string => {
	const { residual } = extractFilters(query);
	return residual;
};
