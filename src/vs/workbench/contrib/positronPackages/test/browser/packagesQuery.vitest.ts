/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import {
	addFilterToQuery,
	applySortToQuery,
	clearFiltersFromQuery,
	PackagesFilter,
	PackagesSortOrder,
	parseQuery,
	removeFilterFromQuery,
} from '../../browser/components/packagesQuery.js';

describe('packagesQuery', () => {

	ensureNoLeakedDisposables();

	describe('parseQuery', () => {
		it('empty input returns default sort and empty text', () => {
			const result = parseQuery('');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
			expect(result.filters).toEqual([]);
		});

		it('whitespace-only input returns default sort and empty text', () => {
			const result = parseQuery('   \t ');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
			expect(result.filters).toEqual([]);
		});

		it('free text without tokens is preserved and trimmed', () => {
			const result = parseQuery('  dplyr  ');
			expect(result.text).toBe('dplyr');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});

		it('@sort:name sets ascending sort', () => {
			const result = parseQuery('@sort:name');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});

		it('@sort:name-desc sets descending sort', () => {
			const result = parseQuery('@sort:name-desc');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});

		it('token matching is case-insensitive for key and value', () => {
			const result = parseQuery('@SORT:NAME-DESC');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});

		it('token is stripped from free text', () => {
			const result = parseQuery('dplyr @sort:name-desc');
			expect(result.text).toBe('dplyr');
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});

		it('token surrounded by free text leaves single-spaced text', () => {
			const result = parseQuery('foo @sort:name-desc bar');
			expect(result.text).toBe('foo bar');
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});

		it('multiple @sort: tokens: last one wins for sort, all stripped from text', () => {
			const result = parseQuery('foo @sort:name bar @sort:name-desc baz');
			expect(result.text).toBe('foo bar baz');
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});

		it('unknown @sort: value is stripped and leaves default sort', () => {
			const result = parseQuery('foo @sort:bogus bar');
			expect(result.text).toBe('foo bar');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});

		it('unknown @key:value token is stripped from free text', () => {
			const result = parseQuery('foo @unknown:value bar');
			expect(result.text).toBe('foo bar');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
			expect(result.filters).toEqual([]);
		});

		it('legacy @filter:outdated is treated as unknown and stripped', () => {
			const result = parseQuery('dplyr @filter:outdated');
			expect(result.text).toBe('dplyr');
			expect(result.filters).toEqual([]);
		});

		it('bare @key attached to free text is stripped', () => {
			const result = parseQuery('foo@bar');
			expect(result.text).toBe('foo');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});
	});

	describe('applySortToQuery', () => {
		it('empty input produces a bare token', () => {
			expect(applySortToQuery('', PackagesSortOrder.NameAsc)).toBe('@sort:name');
			expect(applySortToQuery('', PackagesSortOrder.NameDesc)).toBe('@sort:name-desc');
		});

		it('whitespace-only input produces a bare token', () => {
			expect(applySortToQuery('   ', PackagesSortOrder.NameAsc)).toBe('@sort:name');
		});

		it('free text without a token gets the token prepended', () => {
			expect(applySortToQuery('dplyr', PackagesSortOrder.NameDesc)).toBe('@sort:name-desc dplyr');
		});

		it('existing @sort: token is replaced', () => {
			expect(applySortToQuery('@sort:name dplyr', PackagesSortOrder.NameDesc)).toBe('@sort:name-desc dplyr');
		});

		it('existing @sort: token in the middle is replaced and text re-normalized', () => {
			expect(applySortToQuery('foo @sort:name bar', PackagesSortOrder.NameDesc)).toBe('@sort:name-desc foo bar');
		});

		it('replacement is case-insensitive on existing @sort: token', () => {
			expect(applySortToQuery('@SORT:NAME dplyr', PackagesSortOrder.NameDesc)).toBe('@sort:name-desc dplyr');
		});

		it('non-@sort tokens are preserved', () => {
			expect(applySortToQuery('@outdated dplyr', PackagesSortOrder.NameDesc)).toBe('@sort:name-desc @outdated dplyr');
		});

		it('round-trip: applySortToQuery then parseQuery yields the same sort', () => {
			const applied = applySortToQuery('dplyr', PackagesSortOrder.NameDesc);
			const parsed = parseQuery(applied);
			expect(parsed.text).toBe('dplyr');
			expect(parsed.sort).toBe(PackagesSortOrder.NameDesc);
		});
	});

	describe('parseQuery filters', () => {
		it('@outdated sets Outdated filter', () => {
			const result = parseQuery('@outdated');
			expect(result.text).toBe('');
			expect(result.filters).toEqual([PackagesFilter.Outdated]);
		});

		it('@attached sets Attached filter', () => {
			const result = parseQuery('@attached');
			expect(result.text).toBe('');
			expect(result.filters).toEqual([PackagesFilter.Attached]);
		});

		it('filter token matching is case-insensitive', () => {
			const result = parseQuery('@OUTDATED');
			expect(result.filters).toEqual([PackagesFilter.Outdated]);
		});

		it('filter token is stripped from free text', () => {
			const result = parseQuery('dplyr @outdated');
			expect(result.text).toBe('dplyr');
			expect(result.filters).toEqual([PackagesFilter.Outdated]);
		});

		it('multiple filters are captured in input order', () => {
			const result = parseQuery('@outdated @attached dplyr');
			expect(result.text).toBe('dplyr');
			expect(result.filters).toEqual([PackagesFilter.Outdated, PackagesFilter.Attached]);
		});

		it('filter order follows input order', () => {
			const result = parseQuery('@attached @outdated');
			expect(result.filters).toEqual([PackagesFilter.Attached, PackagesFilter.Outdated]);
		});

		it('duplicate filter tokens are deduped', () => {
			const result = parseQuery('@outdated dplyr @outdated');
			expect(result.text).toBe('dplyr');
			expect(result.filters).toEqual([PackagesFilter.Outdated]);
		});

		it('filter and sort tokens coexist', () => {
			const result = parseQuery('@outdated @sort:name-desc dplyr');
			expect(result.text).toBe('dplyr');
			expect(result.filters).toEqual([PackagesFilter.Outdated]);
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});
	});

	describe('addFilterToQuery', () => {
		it('adds a filter to empty input', () => {
			expect(addFilterToQuery('', PackagesFilter.Outdated)).toBe('@outdated');
		});

		it('prepends the filter token before free text', () => {
			expect(addFilterToQuery('dplyr', PackagesFilter.Outdated)).toBe('@outdated dplyr');
		});

		it('appends a new filter after existing filters to preserve click order', () => {
			expect(addFilterToQuery('@outdated dplyr', PackagesFilter.Attached)).toBe('@outdated @attached dplyr');
		});

		it('is a no-op when the filter is already active', () => {
			expect(addFilterToQuery('@outdated dplyr', PackagesFilter.Outdated)).toBe('@outdated dplyr');
		});

		it('preserves @sort: tokens', () => {
			expect(addFilterToQuery('@sort:name-desc dplyr', PackagesFilter.Outdated)).toBe('@outdated @sort:name-desc dplyr');
		});

		it('strips any lingering legacy @filter: token', () => {
			expect(addFilterToQuery('@filter:outdated dplyr', PackagesFilter.Outdated)).toBe('@outdated dplyr');
		});

		it('round-trip: addFilterToQuery then parseQuery yields the same filter', () => {
			const applied = addFilterToQuery('dplyr', PackagesFilter.Outdated);
			const parsed = parseQuery(applied);
			expect(parsed.text).toBe('dplyr');
			expect(parsed.filters).toEqual([PackagesFilter.Outdated]);
		});

		it('round-trip with two filters preserves click order', () => {
			const a = addFilterToQuery('', PackagesFilter.Attached);
			const b = addFilterToQuery(a, PackagesFilter.Outdated);
			const parsed = parseQuery(b);
			expect(parsed.filters).toEqual([PackagesFilter.Attached, PackagesFilter.Outdated]);
		});
	});

	describe('removeFilterFromQuery', () => {
		it('removes a filter, leaving remaining filters in order', () => {
			expect(removeFilterFromQuery('@outdated @attached dplyr', PackagesFilter.Outdated)).toBe('@attached dplyr');
		});

		it('removing the only filter leaves bare text', () => {
			expect(removeFilterFromQuery('@outdated dplyr', PackagesFilter.Outdated)).toBe('dplyr');
		});

		it('removing the only filter on otherwise-empty input returns empty string', () => {
			expect(removeFilterFromQuery('@outdated', PackagesFilter.Outdated)).toBe('');
		});

		it('is a no-op when the filter is not active', () => {
			expect(removeFilterFromQuery('@attached dplyr', PackagesFilter.Outdated)).toBe('@attached dplyr');
		});

		it('preserves @sort: tokens', () => {
			expect(removeFilterFromQuery('@outdated @sort:name-desc dplyr', PackagesFilter.Outdated)).toBe('@sort:name-desc dplyr');
		});
	});

	describe('clearFiltersFromQuery', () => {
		it('removes all filter tokens but keeps free text and sort', () => {
			expect(clearFiltersFromQuery('@outdated @attached @sort:name-desc dplyr')).toBe('@sort:name-desc dplyr');
		});

		it('is a no-op when no filters are active', () => {
			expect(clearFiltersFromQuery('dplyr')).toBe('dplyr');
		});

		it('strips legacy @filter: tokens as well', () => {
			expect(clearFiltersFromQuery('@filter:outdated @attached dplyr')).toBe('dplyr');
		});

		it('returns empty string when only filter tokens were present', () => {
			expect(clearFiltersFromQuery('@outdated @attached')).toBe('');
		});
	});
});
