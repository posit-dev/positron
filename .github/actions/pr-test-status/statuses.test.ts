/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { depsFromEnv, loadState, saveState, type State } from './statuses.ts';

test('state round-trips through the file, creating its folder', () => {
	const file = join(mkdtempSync(join(tmpdir(), 'pr-test-status-')), 'missing-dir', 'state.json');
	const state: State = { readErrors: 2, statuses: { a: { url: 'u', closed: false, out: { status: 'in_progress', title: 'Running', summary: 's' } } } };
	saveState(file, state);
	assert.deepStrictEqual(loadState(file), state);
	assert.deepStrictEqual(loadState(file + '.missing'), { statuses: {}, readErrors: 0 });
});

test('depsFromEnv: the poll needs BUILDS_TOKEN; finalize without it fails its reads instead', async () => {
	const base = { RUN_ID: '9', HEAD_SHA: 'abc' };
	assert.throws(() => depsFromEnv({ ...base }), /BUILDS_TOKEN/);
	assert.strictEqual(depsFromEnv({ ...base, MODE: 'cancel' }).runId, '9');
	assert.strictEqual(depsFromEnv({ ...base, MODE: 'timeout' }).runId, '9');
	const final = depsFromEnv({ ...base, MODE: 'final' });
	await assert.rejects(final.listJobs('9'), /BUILDS_TOKEN/);
	await assert.rejects(final.getRun('9'), /BUILDS_TOKEN/);
});

