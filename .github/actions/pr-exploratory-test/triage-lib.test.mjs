/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areasOf, issueRow, matchedLinks, milestonedAt, outcomeOf, reportLink } from './triage-lib.mjs';

const BASE = 'https://connect.posit.it/explore/pr-16500-run-9';
const issue = extra => ({
	number: 7, title: 'A bug', created_at: '2026-10-01T10:00:00Z', closed_at: null, state: 'open', state_reason: null, milestone: null,
	labels: [{ name: 'ai-discovered' }, { name: 'area: plots' }], type: { name: 'Bug' }, ...extra,
});

test('reportLink reads the provenance line, and nothing else', () => {
	assert.deepEqual(reportLink(`Body.\n<sub>Reported by [exploratory test](${BASE}/index.html#f3)</sub>`), { base: BASE, finding: 3 });
	assert.equal(reportLink(`See ${BASE}/index.html#f3`), null);
	assert.equal(reportLink(null), null);
});

test('outcomeOf sorts state, reason and milestone into the five outcomes', () => {
	assert.equal(outcomeOf({ state: 'closed', state_reason: 'completed', milestone: { title: 'Future' } }), 'completed');
	assert.equal(outcomeOf({ state: 'closed', state_reason: 'not_planned' }), 'closed');
	assert.equal(outcomeOf({ state: 'closed', state_reason: 'duplicate' }), 'closed');
	assert.equal(outcomeOf({ state: 'open', milestone: null }), 'awaiting');
	assert.equal(outcomeOf({ state: 'open', milestone: { title: 'Future' } }), 'future');
	assert.equal(outcomeOf({ state: 'open', milestone: { title: '2027 Backlog' } }), 'active');
});

test('areasOf keeps only area labels, without the prefix, sorted', () => {
	assert.deepEqual(areasOf([{ name: 'area: ui' }, 'area: data explorer', { name: 'bug' }]), ['data explorer', 'ui']);
	assert.deepEqual(areasOf(), []);
});

test('milestonedAt is the last time the issue entered that milestone', () => {
	const events = [
		{ event: 'milestoned', milestone: { title: 'Future' }, created_at: '2026-10-02T00:00:00Z' },
		{ event: 'milestoned', milestone: { title: '2026.11' }, created_at: '2026-10-05T00:00:00Z' },
		{ event: 'milestoned', milestone: { title: 'Future' }, created_at: '2026-10-08T00:00:00Z' },
		{ event: 'labeled', created_at: '2026-10-09T00:00:00Z' },
	];
	assert.equal(milestonedAt(events, 'Future'), '2026-10-08T00:00:00Z');
	assert.equal(milestonedAt([], 'Future'), null);
});

test('issueRow takes severity from the report and the version from stats', () => {
	const report = { findings: [{ n: 3, severity: 'major' }] };
	const events = [{ event: 'milestoned', milestone: { title: 'Future' }, created_at: '2026-10-08T05:00:00Z' }];
	const row = issueRow(issue({ milestone: { title: 'Future' } }), { base: BASE, finding: 3 }, { report, stats: { version: '1.58' }, events });
	assert.deepEqual(row, {
		num: 7, title: 'A bug', filed: '2026-10-01', closed: null,
		reportUrl: `${BASE}/index.html`, findingUrl: `${BASE}/index.html#f3`,
		sev: 'major', out: 'future', milestone: 'Future', futureSince: '2026-10-08',
		type: 'Bug', areas: ['plots'], source: 'pr', skillVersion: '1.58', via: 'linked',
	});
});

test('issueRow leaves out what it cannot read', () => {
	const row = issueRow(issue({ type: null, state: 'closed', state_reason: 'completed', closed_at: '2026-10-09T00:00:00Z' }), { base: 'https://x/explore-local-1', finding: 9 }, {});
	assert.equal(row.sev, null);
	assert.equal(row.skillVersion, null);
	assert.equal(row.type, null);
	assert.equal(row.futureSince, null);
	assert.equal(row.closed, '2026-10-09');
	assert.equal(row.source, 'local');
});

test('matchedLinks keeps matched issues that mention the PR, once each, and not ones already linked', () => {
	const r = (number, extra = {}) => ({ reportUrl: `${BASE}/index.html`, finding: 2, issue: { number, mentionsPr: true }, ...extra });
	const rows = [
		r(10),
		r(10, { finding: 5 }),
		r(11, { issue: { number: 11, mentionsPr: false } }),
		r(12, { dupOf: 'x' }),
		r(13),
		{ reportUrl: `${BASE}/index.html`, finding: 1 },
	];
	assert.deepEqual(matchedLinks(rows, new Set([13])), [{ number: 10, link: { base: BASE, finding: 2 } }]);
});
