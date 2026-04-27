/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applySortToQuery, PackagesSortOrder, parseQuery } from '../../browser/components/packagesQuery.js';

suite('packagesQuery', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseQuery', () => {
		test('empty input returns default sort and empty text', () => {
			const result = parseQuery('');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.sort, PackagesSortOrder.NameAsc);
			assert.strictEqual(result.loadedOnly, false);
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

		test('@loaded sets loadedOnly and is stripped from text', () => {
			const result = parseQuery('@loaded');
			assert.strictEqual(result.text, '');
			assert.strictEqual(result.loadedOnly, true);
		});

		test('@loaded surrounded by free text leaves single-spaced text', () => {
			const result = parseQuery('foo @loaded bar');
			assert.strictEqual(result.text, 'foo bar');
			assert.strictEqual(result.loadedOnly, true);
		});

		test('@loaded is case-insensitive', () => {
			const result = parseQuery('@LOADED');
			assert.strictEqual(result.loadedOnly, true);
		});

		test('@loaded with a value is treated as unknown and does not set the flag', () => {
			const result = parseQuery('@loaded:true dplyr');
			assert.strictEqual(result.text, 'dplyr');
			assert.strictEqual(result.loadedOnly, false);
		});

		test('@loaded composes with @sort: in either order', () => {
			const a = parseQuery('@loaded @sort:name-desc dplyr');
			assert.strictEqual(a.text, 'dplyr');
			assert.strictEqual(a.sort, PackagesSortOrder.NameDesc);
			assert.strictEqual(a.loadedOnly, true);

			const b = parseQuery('@sort:name-desc @loaded dplyr');
			assert.strictEqual(b.text, 'dplyr');
			assert.strictEqual(b.sort, PackagesSortOrder.NameDesc);
			assert.strictEqual(b.loadedOnly, true);
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
});
