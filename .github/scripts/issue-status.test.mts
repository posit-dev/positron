/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with: node --test .github/scripts/issue-status.test.mts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, milestoneForVersion, statusAt, type DecisionInput } from './issue-status.mts';

const base: DecisionInput = {
	action: 'opened',
	draft: false,
	merged: false,
	intoDefaultBranch: true,
	status: 'Backlog',
	previous: undefined,
	hasMilestone: false,
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

test('merged PR adds a milestone and leaves the status to the board', () => {
	const merged = { ...base, action: 'closed', merged: true, status: 'PR Ready' as const, previous: 'Backlog' as const };
	assert.deepEqual(
		[decide(merged).setStatus, decide(merged).setMilestone],
		[undefined, true],
	);
	// The merge may already have closed the issue and moved it to Done.
	assert.equal(decide({ ...merged, status: 'Done' }).setMilestone, true);
});

test('merged PR keeps an existing milestone and skips non-default branches', () => {
	const merged = { ...base, action: 'closed', merged: true, status: 'PR Ready' as const };
	assert.equal(decide({ ...merged, hasMilestone: true }).setMilestone, undefined);
	assert.equal(decide({ ...merged, intoDefaultBranch: false }).setMilestone, undefined);
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

test('milestoneForVersion maps a version to its release milestone', () => {
	const milestones = [
		{ number: 1, title: 'Future' },
		{ number: 2, title: '2026.11.0 Release' },
		{ number: 3, title: '2026.12.0 Release' },
		{ number: 4, title: '2026 Backlog' },
	];
	assert.equal(milestoneForVersion(milestones, '2026.12.0')?.number, 3);
	assert.equal(milestoneForVersion(milestones, '2026.11.1')?.number, 2);
	assert.equal(milestoneForVersion(milestones, '2027.01.0'), undefined);
	assert.equal(milestoneForVersion(milestones, 'garbage'), undefined);
});
