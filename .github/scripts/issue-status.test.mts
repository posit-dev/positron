/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with: node --test .github/scripts/issue-status.test.mts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, formatMarker, parseMarkers, pickReleaseMilestone, type DecisionInput } from './issue-status.mts';

const base: DecisionInput = {
	action: 'opened',
	draft: false,
	merged: false,
	status: 'Backlog',
	previous: undefined,
	hasMilestone: true,
	otherOpenPRs: false,
};

test('ready PR moves the issue to PR Ready and remembers the old status', () => {
	const d = decide(base);
	assert.equal(d.setStatus, 'PR Ready');
	assert.equal(d.remember, true);
	assert.equal(d.setMilestone, undefined);
});

test('ready PR fills in a missing milestone', () => {
	assert.equal(decide({ ...base, hasMilestone: false }).setMilestone, true);
});

test('draft PR moves the issue to In Progress without a milestone', () => {
	const d = decide({ ...base, draft: true, hasMilestone: false });
	assert.equal(d.setStatus, 'In Progress');
	assert.equal(d.setMilestone, undefined);
});

test('draft PR does not pull an issue down from PR Ready unless converted', () => {
	assert.equal(decide({ ...base, draft: true, status: 'PR Ready' }).setStatus, undefined);
	assert.equal(decide({ ...base, draft: true, status: 'PR Ready', action: 'converted_to_draft' }).setStatus, 'In Progress');
});

test('a second run does not remember again', () => {
	const d = decide({ ...base, status: 'PR Ready', previous: 'Backlog' });
	assert.equal(d.setStatus, undefined);
	assert.equal(d.remember, undefined);
});

test('an issue a human already moved to PR Ready is not remembered', () => {
	const d = decide({ ...base, status: 'PR Ready' });
	assert.equal(d.setStatus, undefined);
	assert.equal(d.remember, undefined);
});

test('issues off the board or already Done are left alone', () => {
	assert.equal(decide({ ...base, status: undefined }).setStatus, undefined);
	assert.equal(decide({ ...base, status: 'Done' }).setStatus, undefined);
	assert.equal(decide({ ...base, status: 'Done', action: 'closed' }).setStatus, undefined);
});

test('merged PR changes nothing', () => {
	const d = decide({ ...base, action: 'closed', merged: true, status: 'PR Ready', previous: 'Backlog' });
	assert.equal(d.setStatus, undefined);
	assert.equal(d.setMilestone, undefined);
});

test('unmerged close restores the saved status', () => {
	const d = decide({ ...base, action: 'closed', status: 'PR Ready', previous: 'Up Next' });
	assert.equal(d.setStatus, 'Up Next');
});

test('unmerged close with no saved status or another open PR does nothing', () => {
	assert.equal(decide({ ...base, action: 'closed', status: 'PR Ready' }).setStatus, undefined);
	assert.equal(decide({ ...base, action: 'closed', status: 'PR Ready', previous: 'Backlog', otherOpenPRs: true }).setStatus, undefined);
});

test('markers round-trip through PR comments', () => {
	const bodies = ['hello', formatMarker(12, 'Up Next'), `${formatMarker(13, 'Triage')}\nmore text`];
	const parsed = parseMarkers(bodies);
	assert.equal(parsed.get(12), 'Up Next');
	assert.equal(parsed.get(13), 'Triage');
	assert.equal(parsed.size, 2);
});

test('picks the earliest release milestone that is not yet due', () => {
	const now = new Date('2026-11-06T00:00:00Z');
	const picked = pickReleaseMilestone([
		{ number: 1, title: 'Future', due_on: null },
		{ number: 2, title: '2026.11.0 Release', due_on: '2026-11-05T00:00:00Z' },
		{ number: 3, title: '2027.01.0 Release', due_on: '2027-01-07T00:00:00Z' },
		{ number: 4, title: '2026.12.0 Release', due_on: '2026-12-03T00:00:00Z' },
		{ number: 5, title: '2026 Backlog', due_on: '2026-12-31T00:00:00Z' },
	], now);
	assert.equal(picked?.number, 4);
});
