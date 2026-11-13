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

test('lane with all jobs done stays in progress while the run is going', () => {
	const jobs = [
		job('e2e / e2e-electron-ubuntu-1', 'completed', 'success'),
		job('ext-host / ext-host', 'completed', 'success'),
	];
	assert.deepStrictEqual(groupLanes(jobs, false).map(l => l.state), ['in_progress', 'in_progress']);
	assert.deepStrictEqual(groupLanes(jobs, true).map(l => l.state), ['success', 'success']);
	assert.strictEqual(groupLanes([job('unit / vitest', 'completed', 'failure')], false)[0].state, 'failure');
});

test('jobs with unexpanded template names are ignored', () => {
	const names = [
		'e2e / ${{ (inputs.display_name || \'e2e-linux\') }}-scan-${{ matrix.shard }}',
		'e2e / ${{ (inputs.display_name || \'e2e-linux\') }}-publish',
		'e2e / inputs.display_name || \'e2e-linux\'',
	];
	assert.deepStrictEqual(names.map(laneName), [null, null, null]);
	const real = ['resolve PR 17258', 'unit / vscode', 'ext-host / ext-host', 'ext-host / ext-host-logs-scan', 'e2e / e2e-electron-ubuntu-1', 'unit / vitest'];
	assert.deepStrictEqual(groupLanes([...names, ...real].map(n => job(n, 'queued'))).map(l => l.name), [
		'e2e / e2e-electron-ubuntu', 'ext-host', 'unit / vitest', 'unit / vscode',
	]);
});
