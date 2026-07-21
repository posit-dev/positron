/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PinsCache } from '../pinsCache.js';

suite('PinsCache', () => {
	let base: string;
	setup(() => { base = mkdtempSync(join(tmpdir(), 'pins-cache-')); });
	teardown(() => { rmSync(base, { recursive: true, force: true }); });

	test('filePath is under pins-cache/<serverHash>/<guid>/<bundle>/<file> and separates servers', () => {
		const cache = new PinsCache(base);
		const a = cache.filePath('https://a.example.com', 'g1', '5', 'data.parquet');
		const b = cache.filePath('https://b.example.com', 'g1', '5', 'data.parquet');

		assert.ok(a.startsWith(join(base, 'pins-cache')), a);
		assert.ok(a.endsWith(join('g1', '5', 'data.parquet')), a);
		// Different servers hash to different directories.
		assert.notStrictEqual(dirname(a), dirname(b));
	});

	test('filePath reduces the file name to its base name so it cannot escape the cache', () => {
		const cache = new PinsCache(base);
		const p = cache.filePath('https://a.example.com', 'g1', '5', '../../etc/passwd');
		assert.ok(p.startsWith(join(base, 'pins-cache')), p);
		assert.ok(p.endsWith('passwd'), p);
		assert.ok(!p.includes('..'), p);
	});

	test('prune removes files older than 30 days and keeps recent ones', async () => {
		const cache = new PinsCache(base);
		const stale = cache.filePath('https://a.example.com', 'old', '1', 'data.parquet');
		const fresh = cache.filePath('https://a.example.com', 'new', '1', 'data.parquet');
		for (const p of [stale, fresh]) {
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, 'x');
		}
		// Backdate the stale file well past the 30-day cutoff.
		const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
		utimesSync(stale, longAgo, longAgo);

		await cache.prune();

		assert.strictEqual(existsSync(stale), false, 'stale file should be pruned');
		assert.strictEqual(existsSync(fresh), true, 'fresh file should be kept');
		// The stale file's now-empty directories are cleaned up too.
		assert.strictEqual(existsSync(dirname(stale)), false, 'empty directory should be removed');
	});

	test('prune is a no-op (does not throw) when nothing is cached', async () => {
		await assert.doesNotReject(() => new PinsCache(base).prune());
	});
});
