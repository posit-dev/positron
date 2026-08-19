/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CanvasLaunchWindowAssigner, ICanvasWindowIdentity, selectCanvasLaunchWindow } from '../../common/positronCanvasLaunch.js';

const freshEmpty: ICanvasWindowIdentity = { workspaceId: undefined, backupFolder: undefined };

function workspaceIdentity(id: string): ICanvasWindowIdentity {
	return { workspaceId: id, backupFolder: undefined };
}

function backupIdentity(folder: string): ICanvasWindowIdentity {
	return { workspaceId: undefined, backupFolder: folder };
}

describe('CanvasLaunchWindowAssigner', () => {
	it('assigns each Canvas launch to exactly one window by consuming the flag', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const firstLaunch = { canvas: true };
		const secondLaunch = { canvas: true };

		expect([
			assigner.assign(firstLaunch, freshEmpty),
			assigner.assign(firstLaunch, freshEmpty),
			assigner.assign(secondLaunch, freshEmpty),
			assigner.assign({}, freshEmpty),
			assigner.assign(undefined, freshEmpty),
		]).toEqual([true, false, true, false, false]);
		expect(firstLaunch.canvas).toBeUndefined();
		expect(secondLaunch.canvas).toBeUndefined();
	});

	it('targets the requested window, not a restored one whose configuration builds first', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const launch = { canvas: true };
		assigner.prime(launch, [{ workspace: { id: 'requested' } }], false);

		expect(assigner.assign(launch, workspaceIdentity('restored'))).toBe(false);
		expect(assigner.assign(launch, workspaceIdentity('requested'))).toBe(true);
		expect(launch.canvas).toBeUndefined();
	});

	it('targets the last-active restored window, which the restore list keeps last', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const launch = { canvas: true };
		assigner.prime(launch, [
			{ workspace: { id: 'background' } },
			{ backupPath: '/backups/background-empty' },
			{ workspace: { id: 'last-active' } },
		], true);

		expect(assigner.assign(launch, workspaceIdentity('background'))).toBe(false);
		expect(assigner.assign(launch, backupIdentity('background-empty'))).toBe(false);
		expect(assigner.assign(launch, workspaceIdentity('last-active'))).toBe(true);
	});

	it('matches a restored empty window by its backup folder', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const launch = { canvas: true };
		assigner.prime(launch, [{ backupPath: '/backups/empty-1' }], true);

		expect(assigner.assign(launch, backupIdentity('empty-1'))).toBe(true);
	});

	it('targets a fresh empty window when the launch opens no identifiable paths', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const launch = { canvas: true };
		assigner.prime(launch, [{}], false);

		expect(assigner.assign(launch, workspaceIdentity('restored'))).toBe(false);
		expect(assigner.assign(launch, freshEmpty)).toBe(true);
	});

	it('keeps a primed target across an interleaved non-canvas open', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const canvasLaunch = { canvas: true };
		assigner.prime(canvasLaunch, [{ workspace: { id: 'requested' } }], false);
		assigner.prime({}, [{ workspace: { id: 'interleaved' } }], false);

		expect(assigner.assign(canvasLaunch, workspaceIdentity('interleaved'))).toBe(false);
		expect(assigner.assign(canvasLaunch, workspaceIdentity('requested'))).toBe(true);
	});

	it('keeps interleaved canvas launches on their own targets', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const firstLaunch = { canvas: true };
		const secondLaunch = { canvas: true };
		assigner.prime(firstLaunch, [{ workspace: { id: 'first' } }], false);
		assigner.prime(secondLaunch, [{ workspace: { id: 'second' } }], false);

		expect([
			assigner.assign(firstLaunch, workspaceIdentity('second')),
			assigner.assign(secondLaunch, workspaceIdentity('first')),
			assigner.assign(firstLaunch, workspaceIdentity('first')),
			assigner.assign(secondLaunch, workspaceIdentity('second')),
		]).toEqual([false, false, true, true]);
	});

	it('interleaved priming cannot revive a fresh-empty target into any-window', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const canvasLaunch = { canvas: true };
		assigner.prime(canvasLaunch, [], false);
		assigner.prime({}, [{ workspace: { id: 'interleaved' } }], false);

		expect(assigner.assign(canvasLaunch, workspaceIdentity('interleaved'))).toBe(false);
		expect(assigner.assign(canvasLaunch, freshEmpty)).toBe(true);
		expect(assigner.assign(canvasLaunch, freshEmpty)).toBe(false);
		expect(canvasLaunch.canvas).toBeUndefined();
	});

	it('re-priming the same args without the flag clears their target', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const launch: { canvas?: boolean } = { canvas: true };
		assigner.prime(launch, [{ workspace: { id: 'stale-target' } }], false);
		delete launch.canvas;
		assigner.prime(launch, [], false);
		launch.canvas = true;

		expect(assigner.assign(launch, workspaceIdentity('anything'))).toBe(true);
	});
});

describe('selectCanvasLaunchWindow', () => {
	it('returns nothing when the launch opened no windows', () => {
		expect(selectCanvasLaunchWindow([], undefined)).toBeUndefined();
	});

	it('targets a single reused window', () => {
		const reused = {};

		expect(selectCanvasLaunchWindow([reused], reused)).toBe(reused);
	});

	it('targets only the last active window when several were used', () => {
		const first = {};
		const lastActive = {};

		expect(selectCanvasLaunchWindow([first, lastActive], lastActive)).toBe(lastActive);
	});

	it('falls back to the first window when the last active one is unrelated', () => {
		const used = {};
		const unrelated = {};

		expect(selectCanvasLaunchWindow([used], unrelated)).toBe(used);
	});
});
