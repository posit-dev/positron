/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMENT_MARKER, askedFindings, findingsPrompt, latestRun, loadProblem, readFindings, readTooLarge } from './claude-findings.mjs';
import { COMMENT_MARKER as LIB_MARKER, renderPrComment } from './lib.mjs';
import { parseResultComment } from './outcomes-lib.mjs';

const BASE = 'https://positron-reports.tail00da2.ts.net/exploratory-report-38443304195-1-opus-ubuntu-x64';
const result = (base, at, login = 'github-actions[bot]') => ({
	user: { login },
	created_at: at,
	body: `<!-- exploratory-test -->\n**\u{1F50E} Exploratory testing** 78afc20\n\n1 moderate\n[View report →](${base}/index.html)\n`,
});

test('askedFindings reads the numbers a comment asks about', () => {
	assert.deepEqual(askedFindings('@claude fix finding 2'), [2]);
	assert.deepEqual(askedFindings('@claude look at Findings 3, 1 and #4 please'), [1, 3, 4]);
	assert.deepEqual(askedFindings('@claude finding #5 is wrong'), [5]);
	assert.deepEqual(askedFindings("@claude I'm finding 2 tests fail on Windows"), []);
	assert.deepEqual(askedFindings(`@claude fix findings ${Array.from({ length: 11 }, (_, i) => i + 1).join(', ')}`), []);
	assert.deepEqual(askedFindings('@claude fix findings 1-3'), [1, 2, 3]);
	assert.deepEqual(askedFindings('@claude fix findings 2 to 4 and 7'), [2, 3, 4, 7]);
	assert.deepEqual(askedFindings('@claude fix finding 2 and finding 3'), [2, 3]);
	assert.deepEqual(askedFindings('@claude fix findings 1-50'), []);
	assert.deepEqual(askedFindings('@claude fix finding 2 - it crashes'), [2]);
});

test('latestRun reads the comment lib.mjs writes, as parseResultComment does', () => {
	assert.equal(COMMENT_MARKER, LIB_MARKER);
	const body = renderPrComment({ state: 'complete', report: { findings: [] }, baseUrl: BASE, runUrl: 'https://x/run', headSha: '78afc20aaaa' });
	const parsed = parseResultComment(body);
	assert.deepEqual(latestRun([{ user: { login: 'github-actions[bot]' }, created_at: '2026-11-01T00:00:00Z', body }]),
		{ run: parsed.run, model: 'opus', report: `${parsed.reportBase}/index.html`, sha: parsed.shortSha });
});

test('latestRun takes only the newest workflow comment, not a quote of one', () => {
	const older = result(BASE.replace('38443304195', '1'), '2026-11-01T00:00:00Z');
	const newer = result(BASE, '2026-11-02T00:00:00Z');
	const quoted = result(BASE.replace('38443304195', '9'), '2026-11-03T00:00:00Z', 'someone');
	assert.deepEqual(latestRun([older, newer, quoted]), { run: '38443304195', model: 'opus', report: `${BASE}/index.html`, sha: '78afc20' });
	assert.equal(latestRun([quoted]), null);
	const running = { ...newer, created_at: '2026-11-04T00:00:00Z', body: `${COMMENT_MARKER}\n**\u{1F50E} Exploratory testing** 1234567\n\nOff exploring, back soon…\n` };
	assert.match(latestRun([newer, running]).problem, /newest exploratory run on this PR \(1234567\) has no report/);
});

test('findingsPrompt wraps the texts in its tag and says what is missing or why none loaded', () => {
	const out = findingsPrompt({ asked: [1, 2, 3], texts: new Map([[1, '## Finding 1\nBroken.\n']]), tooLarge: new Set([3]), report: `${BASE}/index.html`, sha: '78afc20', tag: 't1' });
	assert.match(out, /run on commit 78afc20/);
	assert.match(out, /FINDINGS-t1 START\n\n## Finding 1\nBroken\.\n\nFINDINGS-t1 END$/);
	assert.match(out, /The run has no finding 2\./);
	assert.match(out, /finding 3 was too large to save/);
	assert.notEqual(findingsPrompt({ asked: [1] }).match(/FINDINGS-\S+/)[0], findingsPrompt({ asked: [1] }).match(/FINDINGS-\S+/)[0]);
	assert.match(findingsPrompt({ asked: [3], problem: 'the PR\'s comments could not be read.' }), /finding 3 .*could not be loaded: the PR's comments could not be read/);
	assert.equal(findingsPrompt({ asked: [] }), '');
	// The limit is in bytes: 40,000 three-byte characters pass a character count but not this.
	assert.match(findingsPrompt({ asked: [1], texts: new Map([[1, '\u20ac'.repeat(40_000)]]) }), /could not be loaded: they are too long/);
});

test('loadProblem names the step that failed', () => {
	const ok = { problem: '', run: '1', token: 'success', downloaded: 'success', dirExists: true };
	assert.equal(loadProblem(ok), '');
	assert.equal(loadProblem({ ...ok, problem: 'no run.' }), 'no run.');
	assert.match(loadProblem({ ...ok, token: 'failure' }), /token/);
	assert.match(loadProblem({ ...ok, downloaded: 'failure' }), /could not be downloaded/);
});

test('readFindings reads only regular finding files, and readTooLarge the skipped ones', () => {
	const dir = mkdtempSync(join(tmpdir(), 'claude-findings-'));
	try {
		writeFileSync(join(dir, 'finding-1.md'), 'one');
		symlinkSync('/etc/hosts', join(dir, 'finding-2.md'));
		mkdirSync(join(dir, 'finding-3.md'));
		assert.deepEqual([...readFindings(dir, [1, 2, 3, 4])], [[1, 'one']]);
		assert.deepEqual([...readTooLarge(dir)], []);
		writeFileSync(join(dir, 'too-large.txt'), 'finding-4.md\nfinding-12.md\n');
		assert.deepEqual([...readTooLarge(dir)], [4, 12]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
