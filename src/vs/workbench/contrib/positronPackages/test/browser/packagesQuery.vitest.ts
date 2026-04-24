/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { applySortToQuery, PackagesSortOrder, parseQuery } from '../../browser/components/packagesQuery.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';

describe('packagesQuery', () => {

	beforeEach(() => {
		ensureNoLeakedDisposables();
	});

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
			expect(result.text, 'dplyr');
			expect(result.sort, PackagesSortOrder.NameDesc);
		});

		it('token surrounded by free text leaves single-spaced text', () => {
			const result = parseQuery('foo @sort:name-desc bar');
			expect(result.text, 'foo bar');
			expect(result.sort, PackagesSortOrder.NameDesc);
		});

		it('multiple @sort: tokens: last one wins for sort, all stripped from text', () => {
			const result = parseQuery('foo @sort:name bar @sort:name-desc baz');
			expect(result.text, 'foo bar baz');
			expect(result.sort, PackagesSortOrder.NameDesc);
		});

		it('unknown @sort: value is stripped and leaves default sort', () => {
			const result = parseQuery('foo @sort:bogus bar');
			expect(result.text, 'foo bar');
			expect(result.sort, PackagesSortOrder.NameAsc);
		});

		it('unknown @key token is stripped from free text', () => {
			const result = parseQuery('foo @outdated bar');
			expect(result.text, 'foo bar');
			expect(result.sort, PackagesSortOrder.NameAsc);
		});

		it('unknown @key:value token is stripped from free text', () => {
			const result = parseQuery('foo @author:hadley bar');
			expect(result.text, 'foo bar');
			expect(result.sort, PackagesSortOrder.NameAsc);
		});

		it('unknown token alongside known @sort: token: both stripped', () => {
			const result = parseQuery('@outdated @sort:name-desc dplyr');
			expect(result.text, 'dplyr');
			expect(result.sort, PackagesSortOrder.NameDesc);
		});

		it('bare @key attached to free text is stripped', () => {
			const result = parseQuery('foo@bar');
			expect(result.text, 'foo');
			expect(result.sort, PackagesSortOrder.NameAsc);
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
});
