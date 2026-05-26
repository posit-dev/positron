/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { applyFilterToQuery, applySortToQuery, PackagesFilter, PackagesSortOrder, parseQuery } from '../../browser/components/packagesQuery.js';

describe('packagesQuery', () => {

	ensureNoLeakedDisposables();

	describe('parseQuery', () => {
		it('empty input returns default sort and empty text', () => {
			const result = parseQuery('');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});

		it('whitespace-only input returns default sort and empty text', () => {
			const result = parseQuery('   \t ');
			expect(result.text).toBe('');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
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

		it('unknown @key token is stripped from free text', () => {
			const result = parseQuery('foo @outdated bar');
			expect(result.text).toBe('foo bar');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});

		it('unknown @key:value token is stripped from free text', () => {
			const result = parseQuery('foo @unknown:value bar');
			expect(result.text).toBe('foo bar');
			expect(result.sort).toBe(PackagesSortOrder.NameAsc);
		});

		it('unknown token alongside known @sort: token: both stripped', () => {
			const result = parseQuery('@outdated @sort:name-desc dplyr');
			expect(result.text).toBe('dplyr');
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
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

	describe('parseQuery filter', () => {
		it('empty input returns default All filter', () => {
			const result = parseQuery('');
			expect(result.filter).toBe(PackagesFilter.All);
		});

		it('@filter:outdated sets Outdated filter', () => {
			const result = parseQuery('@filter:outdated');
			expect(result.text).toBe('');
			expect(result.filter).toBe(PackagesFilter.Outdated);
		});

		it('@filter:attached sets Attached filter', () => {
			const result = parseQuery('@filter:attached');
			expect(result.text).toBe('');
			expect(result.filter).toBe(PackagesFilter.Attached);
		});

		it('@filter:all explicitly sets All filter', () => {
			const result = parseQuery('@filter:all');
			expect(result.text).toBe('');
			expect(result.filter).toBe(PackagesFilter.All);
		});

		it('filter token matching is case-insensitive', () => {
			const result = parseQuery('@FILTER:OUTDATED');
			expect(result.filter).toBe(PackagesFilter.Outdated);
		});

		it('filter token is stripped from free text', () => {
			const result = parseQuery('dplyr @filter:outdated');
			expect(result.text).toBe('dplyr');
			expect(result.filter).toBe(PackagesFilter.Outdated);
		});

		it('unknown @filter: value is stripped and leaves default filter', () => {
			const result = parseQuery('foo @filter:bogus bar');
			expect(result.text).toBe('foo bar');
			expect(result.filter).toBe(PackagesFilter.All);
		});

		it('filter and sort tokens coexist', () => {
			const result = parseQuery('@filter:outdated @sort:name-desc dplyr');
			expect(result.text).toBe('dplyr');
			expect(result.filter).toBe(PackagesFilter.Outdated);
			expect(result.sort).toBe(PackagesSortOrder.NameDesc);
		});

		it('multiple @filter: tokens: last one wins, all stripped', () => {
			const result = parseQuery('foo @filter:all bar @filter:outdated baz');
			expect(result.text).toBe('foo bar baz');
			expect(result.filter).toBe(PackagesFilter.Outdated);
		});
	});

	describe('applyFilterToQuery', () => {
		it('default All filter strips any existing token and returns bare text', () => {
			expect(applyFilterToQuery('', PackagesFilter.All)).toBe('');
			expect(applyFilterToQuery('dplyr', PackagesFilter.All)).toBe('dplyr');
			expect(applyFilterToQuery('@filter:outdated dplyr', PackagesFilter.All)).toBe('dplyr');
		});

		it('Outdated filter on empty input produces a bare token', () => {
			expect(applyFilterToQuery('', PackagesFilter.Outdated)).toBe('@filter:outdated');
		});

		it('Attached filter on empty input produces a bare token', () => {
			expect(applyFilterToQuery('', PackagesFilter.Attached)).toBe('@filter:attached');
		});

		it('Outdated filter with free text prepends the token', () => {
			expect(applyFilterToQuery('dplyr', PackagesFilter.Outdated)).toBe('@filter:outdated dplyr');
		});

		it('existing @filter: token is replaced', () => {
			expect(applyFilterToQuery('@filter:all dplyr', PackagesFilter.Outdated)).toBe('@filter:outdated dplyr');
		});

		it('replacement is case-insensitive on existing @filter: token', () => {
			expect(applyFilterToQuery('@FILTER:ALL dplyr', PackagesFilter.Outdated)).toBe('@filter:outdated dplyr');
		});

		it('non-@filter tokens are preserved', () => {
			expect(applyFilterToQuery('@sort:name-desc dplyr', PackagesFilter.Outdated)).toBe('@filter:outdated @sort:name-desc dplyr');
		});

		it('round-trip: applyFilterToQuery then parseQuery yields the same filter', () => {
			const applied = applyFilterToQuery('dplyr', PackagesFilter.Outdated);
			const parsed = parseQuery(applied);
			expect(parsed.text).toBe('dplyr');
			expect(parsed.filter).toBe(PackagesFilter.Outdated);
		});
	});
});
