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

test('state round-trips through the file', () => {
	const file = join(mkdtempSync(join(tmpdir(), 'pr-test-status-')), 'state.json');
	const state: State = { readErrors: 2, statuses: { a: { url: 'u', closed: false, out: { status: 'in_progress', title: 'Running', summary: 's' } } } };
	saveState(file, state);
	assert.deepStrictEqual(loadState(file), state);
	assert.deepStrictEqual(loadState(file + '.missing'), { statuses: {}, readErrors: 0 });
});

test('depsFromEnv needs BUILDS_TOKEN to read, but not for cancel or timeout', () => {
	const base = { RUN_ID: '9', HEAD_SHA: 'abc' };
	assert.throws(() => depsFromEnv({ ...base, MODE: 'final' }), /BUILDS_TOKEN/);
	assert.throws(() => depsFromEnv({ ...base }), /BUILDS_TOKEN/);
	assert.strictEqual(depsFromEnv({ ...base, MODE: 'cancel' }).runId, '9');
	assert.strictEqual(depsFromEnv({ ...base, MODE: 'timeout' }).runId, '9');
});

test('depsFromEnv links final statuses to this run\'s Summary page when it can', () => {
	const base = { RUN_ID: '9', HEAD_SHA: 'abc', BUILDS_TOKEN: 't' };
	assert.strictEqual(depsFromEnv({ ...base, GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'posit-dev/positron', GITHUB_RUN_ID: '42' }).summaryUrl, 'https://github.com/posit-dev/positron/actions/runs/42');
	assert.strictEqual(depsFromEnv(base).summaryUrl, null);
});
