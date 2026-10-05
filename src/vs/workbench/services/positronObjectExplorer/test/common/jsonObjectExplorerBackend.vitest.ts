/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { JsonObjectExplorerBackend } from '../../common/jsonObjectExplorerBackend.js';
import { SearchResult } from '../../common/objectExplorerBackend.js';

/**
 * Summarizes search rows as `path:match_kind` strings.
 */
const summarize = (result: SearchResult) => result.rows.map(row => `${row.path.join('/')}:${row.match_kind}`);

describe('JsonObjectExplorerBackend', () => {
	const disposables = ensureNoLeakedDisposables();
	const createBackend = (value: unknown) => disposables.add(new JsonObjectExplorerBackend('json:test', 'test.json', value));

	it('formats each kind of JSON value', async () => {
		const backend = createBackend({ s: 'text', n: 1.5, b: true, z: null, o: { a: 1, b: [1] }, a: [1, 'x', {}], e: [] });

		const { children } = await backend.getChildren([], 0, 100);

		expect(children.map(c => [c.display_name, c.display_type, c.display_value, c.kind, c.length, c.has_children])).toEqual([
			['s', 'string', '"text"', 'string', 0, false],
			['n', 'number', '1.5', 'number', 0, false],
			['b', 'boolean', 'true', 'boolean', 0, false],
			['z', 'null', 'null', 'empty', 0, false],
			['o', 'object [2]', '{a: 1, b: [...]}', 'map', 2, true],
			['a', 'array [3]', '[1, "x", {}]', 'collection', 3, true],
			['e', 'array [0]', '[]', 'collection', 0, false],
		]);
	});

	it('describes the root with the title and the root accessor', async () => {
		const root = await createBackend({ a: 1 }).getRoot();

		expect([root.display_name, root.display_type, root.accessor]).toEqual(['test.json', 'object [1]', '$']);
	});

	it('truncates long display values', async () => {
		const { children: [child] } = await createBackend({ long: 'x'.repeat(500) }).getChildren([], 0, 1);

		expect(child.display_value).toHaveLength(128);
		expect(child.is_truncated).toBe(true);
	});

	it('pages children', async () => {
		const backend = createBackend(Array.from({ length: 2500 }, (_, i) => i));

		const page = await backend.getChildren([], 1000, 1000);

		expect([page.total, page.children.length, page.children[0].display_name, page.children[999].access_key]).toEqual([2500, 1000, '[1000]', '1999']);
	});

	it('builds JSONPath-style accessors, telling numeric keys from indices', async () => {
		const backend = createBackend({ 'a"b': [{ '0': 'zero' }] });

		const { children: [element] } = await backend.getChildren(['a"b'], 0, 1);
		const { children: [zero] } = await backend.getChildren(['a"b', '0'], 0, 1);

		expect([element.accessor, zero.accessor]).toEqual(['$["a\\"b"][0]', '$["a\\"b"][0]["0"]']);
	});

	it('rejects paths that do not resolve', async () => {
		await expect(createBackend({ a: [1] }).getChildren(['a', '5'], 0, 10)).rejects.toThrow();
	});

	it('formats values as plain text, up to a maximum length', async () => {
		const backend = createBackend({ s: 'text', o: { a: 1 } });

		expect(await Promise.all([
			backend.formatValue(['s']),
			backend.formatValue(['o']),
			backend.formatValue(['s'], 2),
		])).toEqual([
			{ content: 'text', is_truncated: false },
			{ content: '{\n  "a": 1\n}', is_truncated: false },
			{ content: 'te', is_truncated: true },
		]);
	});

	it('fires onDidUpdate when the root is replaced', async () => {
		const backend = createBackend({ a: 1 });
		const listener = vi.fn();
		disposables.add(backend.onDidUpdate(listener));

		backend.setRoot({ b: 2 });

		expect(listener).toHaveBeenCalledTimes(1);
		expect((await backend.getChildren([], 0, 10)).children[0].display_name).toBe('b');
	});

	describe('search', () => {
		const fixture = { alpha: { beta: [1, 'needle', { gamma: 'needle' }] }, delta: 'haystack' };

		it('returns matches with their ancestors in pre-order', async () => {
			const result = await createBackend(fixture).search('NEEDLE', 10, 1000);

			expect(summarize(result)).toEqual([
				'alpha:ancestor',
				'alpha/beta:ancestor',
				'alpha/beta/1:value',
				'alpha/beta/2:ancestor',
				'alpha/beta/2/gamma:value',
			]);
			expect([result.total_matches, result.truncated]).toEqual([2, false]);
		});

		it('does not descend past the maximum depth', async () => {
			const result = await createBackend(fixture).search('needle', 3, 1000);

			expect(summarize(result)).toEqual(['alpha:ancestor', 'alpha/beta:ancestor', 'alpha/beta/1:value']);
		});

		it('stops at the maximum number of results', async () => {
			const result = await createBackend(fixture).search('needle', 10, 1);

			expect([result.total_matches, result.truncated]).toEqual([1, true]);
		});

		it('matches names, and names and values together', async () => {
			const result = await createBackend({ needle: 1, needles: 'needle' }).search('needle', 10, 1000);

			expect(summarize(result)).toEqual(['needle:name', 'needles:name_and_value']);
		});
	});
});
