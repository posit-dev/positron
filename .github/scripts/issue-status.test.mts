/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with: node --test .github/scripts/issue-status.test.mts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, milestoneSetBy, pickReleaseMilestone, statusAt, type DecisionInput } from './issue-status.mts';

const base: DecisionInput = {
	action: 'opened',
	draft: false,
	merged: false,
	status: 'Backlog',
	previous: undefined,
	hasMilestone: true,
	milestoneAddedByUs: false,
	otherOpenPRs: false,
};

test('ready PR moves the issue to PR Ready', () => {
	const d = decide(base);
	assert.equal(d.setStatus, 'PR Ready');
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

test('a second run on an issue already PR Ready changes nothing', () => {
	assert.equal(decide({ ...base, status: 'PR Ready', previous: 'Backlog' }).setStatus, undefined);
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

test('unmerged close removes a milestone this workflow added', () => {
	const closed = { ...base, action: 'closed', status: 'PR Ready' as const, previous: 'Backlog' as const, milestoneAddedByUs: true };
	const d = decide(closed);
	assert.equal(d.setStatus, 'Backlog');
	assert.equal(d.clearMilestone, true);
	// Even when the status needs no restore.
	assert.equal(decide({ ...closed, previous: 'PR Ready' }).clearMilestone, true);
});

test('milestone is kept when a person set it, the PR merged, or another PR is open', () => {
	const closed = { ...base, action: 'closed', status: 'PR Ready' as const, previous: 'Backlog' as const };
	assert.equal(decide(closed).clearMilestone, undefined);
	assert.equal(decide({ ...closed, milestoneAddedByUs: true, merged: true }).clearMilestone, undefined);
	assert.equal(decide({ ...closed, milestoneAddedByUs: true, otherOpenPRs: true }).clearMilestone, undefined);
	assert.equal(decide({ ...closed, milestoneAddedByUs: true, status: 'Up Next' }).clearMilestone, undefined);
});

test('milestoneSetBy only credits the bot for the current milestone after the PR opened', () => {
	const prOpened = '2026-11-05T00:00:00Z';
	const byBot = { createdAt: '2026-11-05T00:00:05Z', milestoneTitle: '2026.12.0 Release', actor: { login: 'positron-projects' } };
	const byPerson = { ...byBot, actor: { login: 'juliasilge' } };
	const early = { ...byBot, createdAt: '2026-11-01T00:00:00Z' };
	assert.equal(milestoneSetBy([byBot], '2026.12.0 Release', 'positron-projects', prOpened), true);
	assert.equal(milestoneSetBy([byBot], '2026.12.0 Release', 'positron-projects[bot]', prOpened), true);
	assert.equal(milestoneSetBy([byPerson], '2026.12.0 Release', 'positron-projects', prOpened), false);
	assert.equal(milestoneSetBy([early], '2026.12.0 Release', 'positron-projects', prOpened), false);
	assert.equal(milestoneSetBy([byBot], '2027.01.0 Release', 'positron-projects', prOpened), false);
	assert.equal(milestoneSetBy([byBot], '2026.12.0 Release', undefined, prOpened), false);
	// A person re-set the same milestone after the bot did; it is theirs now.
	const reset = { ...byPerson, createdAt: '2026-11-06T00:00:00Z' };
	assert.equal(milestoneSetBy([byBot, reset], '2026.12.0 Release', 'positron-projects', prOpened), false);
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
