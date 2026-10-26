/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuesIn, runsUrl } from './recent.ts';

test('runsUrl: completed runs on main since the date', () => {
	const u = new URL(runsUrl('https://api.github.com', 'posit-dev/positron', 'drive-positron-nightly.yml', '2026-10-01'));
	assert.equal(u.pathname, '/repos/posit-dev/positron/actions/workflows/drive-positron-nightly.yml/runs');
	assert.equal(u.searchParams.get('branch'), 'main');
	assert.equal(u.searchParams.get('status'), 'completed');
	assert.equal(u.searchParams.get('created'), '>=2026-10-01');
});

test('issuesIn: each product issue once, from every run', () => {
	const f = (id: string, extra: object) => ({ id, source: 'finder' as const, helper: 'x.sh', steps: ['s'], observed: 'o', expected: 'e', reproductions: [], ...extra });
	assert.deepEqual(issuesIn([
		[f('a', { outcome: 'product', issue: 16340 }), f('b', { outcome: 'fixed' })],
		[f('a', { outcome: 'product', issue: 16340 }), f('c', { outcome: 'product', issue: 15001 })],
	]), [15001, 16340]);
});
