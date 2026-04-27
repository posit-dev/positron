/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyFilterToQuery, applySortToQuery, PackagesFilter, PackagesSortOrder, parseQuery } from '../../browser/components/packagesQuery.js';

suite('packagesQuery', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseQuery', () => {
		test('empty input returns default sort and empty text', () => {
			const result = parseQuery('');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('whitespace-only input returns default sort and empty text', () => {
			const result = parseQuery('   \t ');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('free text without tokens is preserved and trimmed', () => {
			const result = parseQuery('  dplyr  ');
			assert.strictEqual(result.text, 'dplyr');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('@sort:name sets ascending sort', () => {
			const result = parseQuery('@sort:name');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('@sort:name-desc sets descending sort', () => {
			const result = parseQuery('@sort:name-desc');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('token matching is case-insensitive for key and value', () => {
			const result = parseQuery('@SORT:NAME-DESC');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('token is stripped from free text', () => {
			const result = parseQuery('dplyr @sort:name-desc');
			assert.strictEqual(result.text, 'dplyr');
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('token surrounded by free text leaves single-spaced text', () => {
			const result = parseQuery('foo @sort:name-desc bar');
			assert.strictEqual(result.text, 'foo bar');
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('multiple @sort: tokens: last one wins for sort, all stripped from text', () => {
			const result = parseQuery('foo @sort:name bar @sort:name-desc baz');
			assert.strictEqual(result.text, 'foo bar baz');
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('unknown @sort: value is stripped and leaves default sort', () => {
			const result = parseQuery('foo @sort:bogus bar');
			assert.strictEqual(result.text, 'foo bar');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('unknown @key token is stripped from free text', () => {
			const result = parseQuery('foo @outdated bar');
			assert.strictEqual(result.text, 'foo bar');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('unknown @key:value token is stripped from free text', () => {
			const result = parseQuery('foo @author:hadley bar');
			assert.strictEqual(result.text, 'foo bar');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});

		test('unknown token alongside known @sort: token: both stripped', () => {
			const result = parseQuery('@outdated @sort:name-desc dplyr');
			assert.strictEqual(result.text, 'dplyr');
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('bare @key attached to free text is stripped', () => {
			const result = parseQuery('foo@bar');
			assert.strictEqual(result.text, 'foo');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
		});
	});

	suite('applySortToQuery', () => {
		test('empty input produces a bare token', () => {
			assert.strictEqual(applySortToQuery('', PackagesSortOrder.NameAsc), '@sort:name');
			assert.strictEqual(applySortToQuery('', PackagesSortOrder.NameDesc), '@sort:name-desc');
		});

		test('whitespace-only input produces a bare token', () => {
			assert.strictEqual(applySortToQuery('   ', PackagesSortOrder.NameAsc), '@sort:name');
		});

		test('free text without a token gets the token prepended', () => {
			assert.strictEqual(applySortToQuery('dplyr', PackagesSortOrder.NameDesc), '@sort:name-desc dplyr');
		});

		test('existing @sort: token is replaced', () => {
			assert.strictEqual(applySortToQuery('@sort:name dplyr', PackagesSortOrder.NameDesc), '@sort:name-desc dplyr');
		});

		test('existing @sort: token in the middle is replaced and text re-normalized', () => {
			assert.strictEqual(applySortToQuery('foo @sort:name bar', PackagesSortOrder.NameDesc), '@sort:name-desc foo bar');
		});

		test('replacement is case-insensitive on existing @sort: token', () => {
			assert.strictEqual(applySortToQuery('@SORT:NAME dplyr', PackagesSortOrder.NameDesc), '@sort:name-desc dplyr');
		});

		test('non-@sort tokens are preserved', () => {
			assert.strictEqual(applySortToQuery('@outdated dplyr', PackagesSortOrder.NameDesc), '@sort:name-desc @outdated dplyr');
		});

		test('round-trip: applySortToQuery then parseQuery yields the same sort', () => {
			const applied = applySortToQuery('dplyr', PackagesSortOrder.NameDesc);
			const parsed = parseQuery(applied);
			assert.strictEqual(parsed.text, 'dplyr');
			assert.strictEqual(parsed.sort, PackagesSortOrder.NameDesc);
		});
	});

	suite('parseQuery filter', () => {
		test('empty input returns default All filter', () => {
			const result = parseQuery('');
			assert.strictEqual(result.filter, PackagesFilter.All);
		});

		test('@filter:outdated sets Outdated filter', () => {
			const result = parseQuery('@filter:outdated');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.filter, PackagesFilter.Outdated);
		});

		test('@filter:all explicitly sets All filter', () => {
			const result = parseQuery('@filter:all');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.filter, PackagesFilter.All);
		});

		test('filter token matching is case-insensitive', () => {
			const result = parseQuery('@FILTER:OUTDATED');
			assert.strictEqual(result.filter, PackagesFilter.Outdated);
		});

		test('filter token is stripped from free text', () => {
			const result = parseQuery('dplyr @filter:outdated');
			assert.strictEqual(result.text, 'dplyr');
			assert.strictEqual(result.filter, PackagesFilter.Outdated);
		});

		test('unknown @filter: value is stripped and leaves default filter', () => {
			const result = parseQuery('foo @filter:bogus bar');
			assert.strictEqual(result.text, 'foo bar');
			assert.strictEqual(result.filter, PackagesFilter.All);
		});

		test('filter and sort tokens coexist', () => {
			const result = parseQuery('@filter:outdated @sort:name-desc dplyr');
			assert.strictEqual(result.text, 'dplyr');
			assert.strictEqual(result.filter, PackagesFilter.Outdated);
			assert.strictEqual(result.sort, PackagesSortOrder.NameDesc);
		});

		test('multiple @filter: tokens: last one wins, all stripped', () => {
			const result = parseQuery('foo @filter:all bar @filter:outdated baz');
			assert.strictEqual(result.text, 'foo bar baz');
			assert.strictEqual(result.filter, PackagesFilter.Outdated);
		});
	});

	suite('applyFilterToQuery', () => {
		test('default All filter strips any existing token and returns bare text', () => {
			assert.strictEqual(applyFilterToQuery('', PackagesFilter.All), '');
			assert.strictEqual(applyFilterToQuery('dplyr', PackagesFilter.All), 'dplyr');
			assert.strictEqual(applyFilterToQuery('@filter:outdated dplyr', PackagesFilter.All), 'dplyr');
		});

		test('Outdated filter on empty input produces a bare token', () => {
			assert.strictEqual(applyFilterToQuery('', PackagesFilter.Outdated), '@filter:outdated');
		});

		test('Outdated filter with free text prepends the token', () => {
			assert.strictEqual(applyFilterToQuery('dplyr', PackagesFilter.Outdated), '@filter:outdated dplyr');
		});

		test('existing @filter: token is replaced', () => {
			assert.strictEqual(applyFilterToQuery('@filter:all dplyr', PackagesFilter.Outdated), '@filter:outdated dplyr');
		});

		test('replacement is case-insensitive on existing @filter: token', () => {
			assert.strictEqual(applyFilterToQuery('@FILTER:ALL dplyr', PackagesFilter.Outdated), '@filter:outdated dplyr');
		});

		test('non-@filter tokens are preserved', () => {
			assert.strictEqual(applyFilterToQuery('@sort:name-desc dplyr', PackagesFilter.Outdated), '@filter:outdated @sort:name-desc dplyr');
		});

		test('round-trip: applyFilterToQuery then parseQuery yields the same filter', () => {
			const applied = applyFilterToQuery('dplyr', PackagesFilter.Outdated);
			const parsed = parseQuery(applied);
			assert.strictEqual(parsed.text, 'dplyr');
			assert.strictEqual(parsed.filter, PackagesFilter.Outdated);
		});
	});
});
