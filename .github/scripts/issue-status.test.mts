/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with: node --test .github/scripts/issue-status.test.mts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isBefore, releaseTitle, statusAt, type DecisionInput } from './issue-status.mts';

const base: DecisionInput = {
	action: 'opened',
	draft: false,
	merged: false,
	intoDefaultBranch: true,
	status: 'Backlog',
	previous: undefined,
	milestone: undefined,
	release: undefined,
	otherOpenPRs: false,
};

test('ready PR moves the issue to PR Ready without touching the milestone', () => {
	const d = decide(base);
	assert.equal(d.setStatus, 'PR Ready');
	assert.equal(d.setMilestone, undefined);
});

test('draft PR moves the issue to In Progress', () => {
	assert.equal(decide({ ...base, draft: true }).setStatus, 'In Progress');
});

test('draft PR does not pull an issue down from PR Ready unless converted', () => {
	assert.equal(decide({ ...base, draft: true, status: 'PR Ready' }).setStatus, undefined);
	assert.equal(decide({ ...base, draft: true, status: 'PR Ready', action: 'converted_to_draft' }).setStatus, 'In Progress');
});

test('a second run on an issue already PR Ready changes nothing', () => {
	assert.equal(decide({ ...base, status: 'PR Ready', previous: 'Backlog' }).setStatus, undefined);
});

test('issues off the board or already Done are left alone', () => {
	assert.equal(decide({ ...base, status: undefined }).setStatus, undefined);
	assert.equal(decide({ ...base, status: 'Done' }).setStatus, undefined);
	assert.equal(decide({ ...base, status: 'Done', action: 'closed' }).setStatus, undefined);
});

const merged = { ...base, action: 'closed', merged: true, status: 'PR Ready' as const, release: '2026.12.0 Release' };

test('merged PR adds a milestone and leaves the status to the board', () => {
	assert.deepEqual(
		[decide(merged).setStatus, decide(merged).setMilestone],
		[undefined, true],
	);
	// The merge may already have closed the issue and moved it to Done.
	assert.equal(decide({ ...merged, status: 'Done' }).setMilestone, true);
});

test('merged PR replaces a planning or earlier release milestone', () => {
	assert.equal(decide({ ...merged, milestone: '2026.11.0 Release' }).setMilestone, true);
	assert.equal(decide({ ...merged, milestone: '2026 Backlog' }).setMilestone, true);
	assert.equal(decide({ ...merged, milestone: 'Future' }).setMilestone, true);
});

test('merged PR keeps the same or a later release, and skips non-default branches', () => {
	assert.equal(decide({ ...merged, milestone: '2026.12.0 Release' }).setMilestone, undefined);
	assert.equal(decide({ ...merged, milestone: '2027.01.0 Release' }).setMilestone, undefined);
	assert.equal(decide({ ...merged, intoDefaultBranch: false }).setMilestone, undefined);
	assert.equal(decide({ ...merged, release: undefined }).setMilestone, undefined);
});

test('unmerged close restores the status from when the PR opened', () => {
	assert.equal(decide({ ...base, action: 'closed', status: 'PR Ready', previous: 'Up Next' }).setStatus, 'Up Next');
	assert.equal(decide({ ...base, action: 'closed', status: 'PR Ready', previous: 'In Progress' }).setStatus, 'In Progress');
});

test('unmerged close with no earlier status or another open PR does nothing', () => {
	assert.equal(decide({ ...base, action: 'closed', status: 'PR Ready' }).setStatus, undefined);
	assert.equal(decide({ ...base, action: 'closed', status: 'PR Ready', previous: 'Backlog', otherOpenPRs: true }).setStatus, undefined);
});

test('unmerged close leaves an issue someone moved off In Progress or PR Ready', () => {
	assert.equal(decide({ ...base, action: 'closed', status: 'Up Next', previous: 'Backlog' }).setStatus, undefined);
});

test('statusAt reads the latest change on the board at or before the time', () => {
	const changes = [
		{ createdAt: '2026-11-01T00:00:00Z', status: 'Triage', project: { number: 2 } },
		{ createdAt: '2026-11-03T00:00:00Z', status: 'Backlog', project: { number: 2 } },
		{ createdAt: '2026-11-04T00:00:00Z', status: 'Doing', project: { number: 9 } },
		{ createdAt: '2026-11-05T00:00:00Z', status: 'PR Ready', project: { number: 2 } },
	];
	assert.equal(statusAt(changes, 2, '2026-11-04T12:00:00Z'), 'Backlog');
	assert.equal(statusAt(changes, 2, '2026-11-03T00:00:00Z'), 'Backlog');
	assert.equal(statusAt(changes, 2, '2026-10-01T00:00:00Z'), undefined);
});

test('statusAt treats a cleared status as no status', () => {
	const changes = [
		{ createdAt: '2026-11-01T00:00:00Z', status: 'Backlog', project: { number: 2 } },
		{ createdAt: '2026-11-02T00:00:00Z', status: '', project: { number: 2 } },
	];
	assert.equal(statusAt(changes, 2, '2026-11-03T00:00:00Z'), undefined);
});

test('releaseTitle maps a version to its release milestone', () => {
	assert.equal(releaseTitle('2026.12.0'), '2026.12.0 Release');
	assert.equal(releaseTitle('2026.11.1'), '2026.11.0 Release');
	assert.equal(releaseTitle('garbage'), undefined);
});

test('isBefore orders releases across a year boundary', () => {
	assert.equal(isBefore('2026.12.0 Release', '2027.01.0 Release'), true);
	assert.equal(isBefore('2027.01.0 Release', '2026.12.0 Release'), false);
	assert.equal(isBefore(undefined, '2026.12.0 Release'), true);
});
