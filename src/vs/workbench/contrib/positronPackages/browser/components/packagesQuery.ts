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
}

/**
 * Parses the filter input into a free-text portion and the structured tokens
 * it contains. Unrecognized `@...` tokens are left in the text so the user
 * sees what they typed.
 */
export const parseQuery = (query: string): ParsedQuery => {
	let sort: PackagesSortOrder = PackagesSortOrder.NameAsc;

	const text = query.replace(TOKEN_REGEX, (match, key: string, value: string | undefined) => {
		if (key.toLowerCase() === 'sort' && value !== undefined) {
			const order = SORT_TOKEN_TO_ORDER[value.toLowerCase()];
			if (order !== undefined) {
				sort = order;
				return '';
			}
		}
		return match;
	}).replace(/\s+/g, ' ').trim();

	return { text, sort };
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
