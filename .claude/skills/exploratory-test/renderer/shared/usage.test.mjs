/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportUsage, reportUsageOnce } from './usage.mjs';

const ROW = { email: 'a@posit.co', event: 'finished', runId: '20261001T100000', stats: { where: 'local', turns: 3 } };

test('reportUsage posts one row with the stats as JSON', async () => {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, body: Object.fromEntries(init.body) });
		return { ok: true };
	};
	assert.equal(await reportUsage(ROW, { fetch, env: {} }), true);
	assert.equal(calls.length, 1);
	assert.match(calls[0].url, /\/formResponse$/);
	assert.deepEqual(Object.values(calls[0].body), ['a@posit.co', 'finished', '20261001T100000', '{"where":"local","turns":3}']);
});

test('reportUsage sends nothing when opted out', async () => {
	let called = false;
	const fetch = async () => { called = true; return { ok: true }; };
	assert.equal(await reportUsage(ROW, { fetch, env: { EXPLORATORY_TEST_NO_USAGE: '1' } }), false);
	assert.equal(called, false);
});

test('reportUsage swallows network errors and timeouts', async () => {
	assert.equal(await reportUsage(ROW, { fetch: async () => { throw new Error('offline'); }, env: {} }), false);
	const hang = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
	assert.equal(await reportUsage(ROW, { fetch: hang, env: {}, timeoutMs: 20 }), false);
});

test('reportUsageOnce sends one row per run, and retries a send that failed', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'usage-'));
	try {
		let calls = 0;
		let ok = false;
		const fetch = async () => { calls++; return { ok }; };
		assert.equal(await reportUsageOnce(dir, ROW, { fetch, env: {} }), false);
		ok = true;
		assert.equal(await reportUsageOnce(dir, ROW, { fetch, env: {} }), true);
		assert.equal(await reportUsageOnce(dir, ROW, { fetch, env: {} }), false);
		assert.equal(calls, 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('reportUsageOnce sends nothing for a CI run, which a local render can only be replaying', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'usage-'));
	try {
		writeFileSync(join(dir, 'cost.json'), '{}');
		let calls = 0;
		assert.equal(await reportUsageOnce(dir, ROW, { fetch: async () => { calls++; return { ok: true }; }, env: {} }), false);
		assert.equal(calls, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
