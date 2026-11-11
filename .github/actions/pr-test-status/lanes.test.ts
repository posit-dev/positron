/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupLanes, laneName, type Job } from './lanes.ts';

let nextId = 1;
const job = (name: string, status: Job['status'], conclusion: string | null = null): Job => ({
	id: nextId++, name, status, conclusion, html_url: `https://example.test/job/${nextId}`,
});

test('laneName', () => {
	assert.deepStrictEqual([
		'unit / vscode', 'unit / vitest', 'ext-host / ext-host', 'ext-host / ext-host-logs-scan',
		'e2e / e2e-electron-ubuntu-1', 'e2e / e2e-electron-ubuntu-12', 'e2e / e2e-electron-ubuntu-scan-3',
		'e2e / e2e-electron-ubuntu', 'e2e / e2e-electron-ubuntu-publish', 'e2e / e2e-windows-2', 'resolve PR 17',
	].map(laneName), [
		'unit / vscode', 'unit / vitest', 'ext-host', 'ext-host',
		'e2e / e2e-electron-ubuntu', 'e2e / e2e-electron-ubuntu', 'e2e / e2e-electron-ubuntu',
		'e2e / e2e-electron-ubuntu', 'e2e / e2e-electron-ubuntu', 'e2e / e2e-windows', null,
	]);
});

test('groupLanes rolls shards into one lane', () => {
	const lanes = groupLanes([
		job('e2e / e2e-electron-ubuntu-2', 'completed', 'success'),
		job('e2e / e2e-electron-ubuntu-1', 'completed', 'success'),
		job('e2e / e2e-electron-ubuntu-publish', 'completed', 'success'),
		job('unit / vscode', 'completed', 'success'),
	]);
	assert.deepStrictEqual(lanes.map(l => [l.name, l.jobs.length, l.state]), [
		['e2e / e2e-electron-ubuntu', 3, 'success'],
		['unit / vscode', 1, 'success'],
	]);
});

test('lane in progress while a shard runs', () => {
	const [lane] = groupLanes([
		job('e2e / e2e-windows-1', 'completed', 'failure'),
		job('e2e / e2e-windows-2', 'in_progress'),
	]);
	assert.equal(lane.state, 'in_progress');
});

test('failure wins over cancelled', () => {
	const [lane] = groupLanes([
		job('e2e / e2e-windows-1', 'completed', 'cancelled'),
		job('e2e / e2e-windows-2', 'completed', 'timed_out'),
	]);
	assert.equal(lane.state, 'failure');
});

test('cancelled lane', () => {
	const [lane] = groupLanes([
		job('e2e / e2e-windows-1', 'completed', 'success'),
		job('e2e / e2e-windows-2', 'completed', 'cancelled'),
	]);
	assert.equal(lane.state, 'cancelled');
});

test('all-skipped lane is left out', () => {
	assert.deepStrictEqual(groupLanes([
		job('unit / vitest', 'completed', 'skipped'),
		job('ext-host / ext-host', 'completed', 'success'),
	]).map(l => l.name), ['ext-host']);
});

test('skipped jobs inside a run lane do not fail it', () => {
	const [lane] = groupLanes([
		job('e2e / e2e-electron-ubuntu-1', 'completed', 'success'),
		job('e2e / e2e-electron-ubuntu-publish', 'completed', 'skipped'),
	]);
	assert.equal(lane.state, 'success');
});

test('resolve job is not a lane', () => {
	assert.deepStrictEqual(groupLanes([job('resolve PR 123', 'completed', 'success')]), []);
});
