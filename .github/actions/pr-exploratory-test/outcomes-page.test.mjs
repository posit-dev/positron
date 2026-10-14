/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceHtml, renderOutcomesPage, summarize } from './outcomes-page.mjs';

const row = (outcome, extra = {}) => ({
	pr: 1, run: '10', finding: 1, title: 'A finding', severity: 'minor', trigger: 'explore',
	reportUrl: 'https://example.com/r/index.html', outcome, evidence: '', ...extra,
});

test('summarize counts fixed against known outcomes, leaving out pending, unclear and duplicates', () => {
	const s = summarize([
		row('fixed-in-pr'), row('fixed-in-pr'), row('fixed-later'), row('not-acted-on'),
		row('pending'), row('unclear'), row('no-paths'), row('fixed-in-pr', { dupOf: '9#1' }),
	]);
	assert.deepEqual(s, { fixedInPr: 2, fixedLater: 1, known: 4, unknown: 2, pending: 1 });
});

test('the headline gives fixed out of known, with the rest named under it', () => {
	const html = renderOutcomesPage([row('fixed-in-pr'), row('fixed-later'), row('not-acted-on'), row('unclear'), row('pending')]);
	assert.match(html, /2 of 3 findings with a known outcome were fixed \(1 in the PR, 1 later\)/);
	assert.match(html, /1 couldn't be told, 1 still pending/);
});

test('each group gets a bar whose segments hold its counts, in outcome order', () => {
	const html = renderOutcomesPage([row('not-acted-on', { trigger: 'auto' }), row('fixed-in-pr', { trigger: 'auto' }), row('pending')]);
	const auto = html.match(/<div class="bar-row"><span class="bar-label">Auto-run<\/span>([\s\S]*?)<\/div><\/div>/)[1];
	assert.ok(auto.indexOf('Fixed in the PR: 1') < auto.indexOf('Not acted on: 1'));
	assert.doesNotMatch(auto, /Pending/);
	assert.match(html, /<span class="bar-label">\/explore<\/span>[\s\S]*?Pending: 1/);
});

test('a group with fewer than five known outcomes says it is too few to compare', () => {
	const html = renderOutcomesPage([row('fixed-in-pr', { severity: 'major' }), ...Array(5).fill(row('not-acted-on'))]);
	assert.match(html, /<span class="bar-label">Major<\/span>[\s\S]*?too few to compare/);
	assert.doesNotMatch(html, /<span class="bar-label">Minor<\/span>[^\n]*too few to compare/);
});

test('rows without a trigger, from before it was recorded, group as unknown', () => {
	const { trigger, ...old } = row('fixed-in-pr');
	assert.match(renderOutcomesPage([old]), /<span class="bar-label">Unknown<\/span>/);
});

test('the table links each finding to its report and PR, and lists duplicates apart', () => {
	const html = renderOutcomesPage([row('fixed-in-pr', { pr: 16556 }), row('fixed-in-pr', { pr: 16556, run: '11', dupOf: '10#1' })]);
	assert.match(html, /<a href="https:\/\/example.com\/r\/index.html">A finding<\/a>/);
	assert.match(html, /<a href="https:\/\/github.com\/posit-dev\/positron\/pull\/16556">#16556<\/a>/);
	assert.match(html, /<h2>Duplicates \(1\)<\/h2>[\s\S]*dup of 10#1/);
	assert.match(html, /<h2>Fixed in the PR \(1\)<\/h2>/);
});

test('evidence links the commits and issue its source names, not numbers in the reason', () => {
	assert.equal(
		evidenceHtml('pr (whole) a15cdab1c1,73456c1fcd: fixes #12 <b>'),
		'pr (whole) <a href="https://github.com/posit-dev/positron/commit/a15cdab1c1"><code>a15cdab1c1</code></a>,<a href="https://github.com/posit-dev/positron/commit/73456c1fcd"><code>73456c1fcd</code></a>: fixes #12 &lt;b&gt;',
	);
	assert.equal(evidenceHtml('pr abc1234: drops `<b>` now'), 'pr <a href="https://github.com/posit-dev/positron/commit/abc1234"><code>abc1234</code></a>: drops <code>&lt;b&gt;</code> now');
	assert.match(evidenceHtml('issue #16290: same problem'), /^issue <a href="https:\/\/github.com\/posit-dev\/positron\/issues\/16290">#16290<\/a>: /);
});

test('titles are escaped and a report URL that is not http(s) is not linked', () => {
	const html = renderOutcomesPage([row('pending', { title: '<img src=x onerror=alert(1)>', reportUrl: 'javascript:alert(1)' })]);
	assert.ok(!html.includes('<img src=x'));
	assert.ok(!html.includes('javascript:'));
});
