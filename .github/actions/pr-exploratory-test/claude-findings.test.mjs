/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askedFindings, findingsPrompt, latestRun, readFindings } from './claude-findings.mjs';

const BASE = 'https://positron-reports.tail00da2.ts.net/exploratory-report-38443304195-1-opus-ubuntu-x64';
const result = (base, at, login = 'github-actions[bot]') => ({
	user: { login },
	created_at: at,
	body: `<!-- exploratory-test -->\n**\u{1F50E} Exploratory testing** 78afc20\n\n1 moderate\n[View report →](${base}/index.html)\n`,
});

test('askedFindings reads the numbers a comment names', () => {
	assert.deepEqual(askedFindings('@claude fix finding 2'), [2]);
	assert.deepEqual(askedFindings('@claude look at Findings 3, 1 and #4 please'), [1, 3, 4]);
	assert.deepEqual(askedFindings('@claude what did you find?'), []);
	assert.deepEqual(askedFindings(`@claude findings ${Array.from({ length: 11 }, (_, i) => i + 1).join(', ')}`), []);
});

test('latestRun takes the newest workflow result comment, not a quote of one', () => {
	const older = result(BASE.replace('38443304195', '1'), '2026-11-01T00:00:00Z');
	const newer = result(BASE, '2026-11-02T00:00:00Z');
	const quoted = result(BASE.replace('38443304195', '9'), '2026-11-03T00:00:00Z', 'someone');
	assert.deepEqual(latestRun([older, newer, quoted]), { run: '38443304195', model: 'opus', report: `${BASE}/index.html` });
	assert.equal(latestRun([quoted]), null);
});

test('findingsPrompt wraps the texts, notes a missing one, and says why none loaded', () => {
	const out = findingsPrompt({ asked: [1, 2], texts: new Map([[1, '## Finding 1\nBroken.\n']]), report: `${BASE}/index.html` });
	assert.match(out, /FINDINGS START\n\n## Finding 1\nBroken\.\n\nFINDINGS END$/);
	assert.match(out, /The run has no finding 2\./);
	assert.match(findingsPrompt({ asked: [3], problem: 'the run\'s saved findings have expired or were never saved.' }),
		/finding 3 .*could not be loaded: the run's saved findings have expired/);
	assert.equal(findingsPrompt({ asked: [] }), '');
});

test('readFindings reads only regular finding files', () => {
	const dir = mkdtempSync(join(tmpdir(), 'claude-findings-'));
	try {
		writeFileSync(join(dir, 'finding-1.md'), 'one');
		symlinkSync('/etc/hosts', join(dir, 'finding-2.md'));
		mkdirSync(join(dir, 'finding-3.md'));
		assert.deepEqual([...readFindings(dir, [1, 2, 3, 4])], [[1, 'one']]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
