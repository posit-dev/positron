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
 * PackagesFilter enum.
 */
export enum PackagesFilter {
	All = 'all',
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

// Token value <-> PackagesFilter mapping for the `@filter:<value>` token.
// `all` is the implicit default and is never serialized into the input.
const FILTER_TOKEN_TO_FILTER: Record<string, PackagesFilter> = {
	'outdated': PackagesFilter.Outdated,
	'attached': PackagesFilter.Attached,
};

const FILTER_TO_TOKEN: Record<PackagesFilter, string> = {
	[PackagesFilter.All]: 'all',
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
	/** Active category filter. */
	readonly filter: PackagesFilter;
}

/**
 * Parses the filter input into a free-text portion and the structured tokens
 * it contains. All `@key[:value]` tokens are consumed, even when unrecognized,
 * so unknown tokens don't leak into free-text filtering and produce
 * empty-result-set surprises.
 */
export const parseQuery = (query: string): ParsedQuery => {
	let sort: PackagesSortOrder = PackagesSortOrder.NameAsc;
	let filter: PackagesFilter = PackagesFilter.All;

	const text = query.replace(TOKEN_REGEX, (_match, key: string, value: string | undefined) => {
		const lowerKey = key.toLowerCase();
		if (lowerKey === 'sort' && value !== undefined) {
			const order = SORT_TOKEN_TO_ORDER[value.toLowerCase()];
			if (order !== undefined) {
				sort = order;
			}
		} else if (lowerKey === 'filter' && value !== undefined) {
			const parsed = FILTER_TOKEN_TO_FILTER[value.toLowerCase()];
			if (parsed !== undefined) {
				filter = parsed;
			}
		}
		return '';
	}).replace(/\s+/g, ' ').trim();

	return { text, sort, filter };
};

/**
 * Returns a new filter input string with any existing `@sort:` token replaced
 * by the token for the given sort order, preserving surrounding free-text.
 */
export const applySortToQuery = (query: string, sort: PackagesSortOrder): string => {
	const stripped = query.replace(/@sort:[\w-]+/gi, '').replace(/\s+/g, ' ').trim();
	const token = `@sort:${SORT_ORDER_TO_TOKEN[sort]}`;
	return stripped ? `${token} ${stripped}` : token;
};

/**
 * Returns a new filter input string with any existing `@filter:` token
 * replaced by the token for the given category filter, preserving surrounding
 * free-text. The default `All` filter is never serialized -- applying it
 * simply strips any existing `@filter:` token.
 */
export const applyFilterToQuery = (query: string, filter: PackagesFilter): string => {
	const stripped = query.replace(/@filter:[\w-]+/gi, '').replace(/\s+/g, ' ').trim();
	if (filter === PackagesFilter.All) {
		return stripped;
	}
	const token = `@filter:${FILTER_TO_TOKEN[filter]}`;
	return stripped ? `${token} ${stripped}` : token;
};
