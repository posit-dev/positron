/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ICachedNotebookRender, NotebookRenderCache } from '../../browser/notebookRenderCache.js';

function makeEntry(name: string): ICachedNotebookRender {
	return {
		uri: URI.parse(`test:///${name}.ipynb`),
		container: document.createElement('div'),
		renderer: stubInterface<PositronReactRenderer>(),
	};
}

describe('NotebookRenderCache', () => {
	describe('get', () => {
		it('returns undefined for an unknown URI', () => {
			const cache = new NotebookRenderCache(3, vi.fn());

			expect(cache.get(URI.parse('test:///missing.ipynb'))).toBeUndefined();
		});

		it('returns the entry on hit', () => {
			const cache = new NotebookRenderCache(3, vi.fn());
			const a = makeEntry('a');
			cache.add(a);

			expect(cache.get(a.uri)).toBe(a);
		});

		it('promotes a hit entry to most-recently-used', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);
			const a = makeEntry('a');
			const b = makeEntry('b');
			const c = makeEntry('c');
			cache.add(a);
			cache.add(b);
			cache.add(c);

			// Promote `a` from LRU to MRU. New order is [b, c, a].
			cache.get(a.uri);

			// Adding a 4th entry must now evict `b`, not `a`.
			cache.add(makeEntry('d'));
			expect(onEvict).toHaveBeenCalledTimes(1);
			expect(onEvict).toHaveBeenCalledWith(b);
		});
	});

	describe('add', () => {
		it('appends below capacity without evicting', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);
			cache.add(makeEntry('a'));
			cache.add(makeEntry('b'));

			expect(cache.size).toBe(2);
			expect(onEvict).not.toHaveBeenCalled();
		});

		it('evicts the least-recently-used entry when at capacity', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);
			const a = makeEntry('a');
			const b = makeEntry('b');
			const c = makeEntry('c');
			const d = makeEntry('d');
			cache.add(a);
			cache.add(b);
			cache.add(c);
			cache.add(d);

			expect(onEvict).toHaveBeenCalledTimes(1);
			expect(onEvict).toHaveBeenCalledWith(a);
			expect(cache.size).toBe(3);
			expect(cache.entries().map(e => e.uri)).toEqual([b.uri, c.uri, d.uri]);
		});
	});

	describe('remove', () => {
		it('is a no-op when no entry matches', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);
			cache.add(makeEntry('a'));

			cache.remove(URI.parse('test:///missing.ipynb'));

			expect(onEvict).not.toHaveBeenCalled();
			expect(cache.size).toBe(1);
		});

		it('removes and evicts the matching entry without touching others', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);
			const a = makeEntry('a');
			const b = makeEntry('b');
			const c = makeEntry('c');
			cache.add(a);
			cache.add(b);
			cache.add(c);

			cache.remove(b.uri);

			expect(onEvict).toHaveBeenCalledTimes(1);
			expect(onEvict).toHaveBeenCalledWith(b);
			expect(cache.entries().map(e => e.uri)).toEqual([a.uri, c.uri]);
		});
	});

	describe('clear', () => {
		it('is a no-op on an empty cache', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);

			cache.clear();

			expect(onEvict).not.toHaveBeenCalled();
		});

		it('evicts all entries in most-recently-used-first order', () => {
			const onEvict = vi.fn();
			const cache = new NotebookRenderCache(3, onEvict);
			const a = makeEntry('a');
			const b = makeEntry('b');
			const c = makeEntry('c');
			cache.add(a);
			cache.add(b);
			cache.add(c);

			cache.clear();

			expect(onEvict.mock.calls.map(call => call[0])).toEqual([c, b, a]);
			expect(cache.size).toBe(0);
		});
	});
});
