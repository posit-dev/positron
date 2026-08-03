/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { NullLogService } from '../../../log/common/log.js';
import { EXTERNAL_OPEN_EXIT_WAIT } from '../../common/positronStandaloneMode.js';
import { PositronStandaloneModeMainService } from '../../electron-main/positronStandaloneModeMainService.js';

// The service watches windows through electron's app; the tests drive those
// watchers by invoking the captured `browser-window-created` handler with a
// hand-made window, since electron's real objects cannot exist outside the
// main process.
const { electronApp } = vi.hoisted(() => ({
	electronApp: {
		listeners: new Map<string, (...args: unknown[]) => void>(),
		on(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, listener); },
		removeListener(event: string) { this.listeners.delete(event); },
	}
}));
vi.mock('electron', () => ({ app: electronApp, BrowserWindow: class { } }));

/** A window as far as the service's watchers are concerned. */
function createWindow(id: number) {
	const windowListeners = new Map<string, () => void>();
	const webContentsListeners = new Map<string, () => void>();
	const window = {
		id,
		on: (event: string, listener: () => void) => windowListeners.set(event, listener),
		webContents: { on: (event: string, listener: () => void) => webContentsListeners.set(event, listener) },
	};
	electronApp.listeners.get('browser-window-created')?.(undefined, window);
	return {
		close: () => windowListeners.get('closed')?.(),
		reload: () => webContentsListeners.get('did-navigate')?.(),
		crash: () => webContentsListeners.get('render-process-gone')?.(),
	};
}

describe('PositronStandaloneModeMainService', () => {
	const disposables = ensureNoLeakedDisposables();

	function build() {
		return disposables.add(new PositronStandaloneModeMainService(new NullLogService()));
	}

	it('grants the claim to one window and denies the other', async () => {
		const service = build();

		expect(await service.acquire(1, 'test.exit')).toBe(true);
		expect(await service.acquire(2, 'test.exit')).toBe(false);

		// The loser's failed claim must not have disturbed the holder.
		expect(service.isEngaged).toBe(true);
		expect(service.isEngagedElsewhere(1)).toBe(false);
		expect(service.isEngagedElsewhere(2)).toBe(true);
	});

	it('lets the holder reclaim without a release in between', async () => {
		const service = build();

		expect(await service.acquire(1, 'test.exit')).toBe(true);
		expect(await service.acquire(1, 'test.exit')).toBe(true);
	});

	it('uses the exit command declared by the holder\'s latest acquire', async () => {
		const service = build();
		await service.acquire(1, 'test.oldExit');
		await service.acquire(1, 'test.newExit');
		const exitMode = vi.fn(() => void service.release(1));

		await service.handleExternalOpen(vi.fn(), exitMode);

		expect(exitMode).toHaveBeenCalledWith(1, 'test.newExit');
	});

	it('ignores a release from a window that does not hold the claim', async () => {
		const service = build();
		await service.acquire(1, 'test.exit');

		await service.release(2);

		expect(service.isEngaged).toBe(true);
	});

	it('frees the claim for the next window once the holder releases', async () => {
		const service = build();
		await service.acquire(1, 'test.exit');

		await service.release(1);

		expect(service.isEngaged).toBe(false);
		expect(await service.acquire(2, 'test.exit')).toBe(true);
	});

	it('releases the claim when the engaged window closes, reloads, or loses its renderer', async () => {
		for (const goAway of ['close', 'reload', 'crash'] as const) {
			const service = build();
			const window = createWindow(7);
			await service.acquire(7, 'test.exit');

			window[goAway]();

			expect(service.isEngaged).toBe(false);
		}
	});

	it('keeps the claim when an unrelated window goes away', async () => {
		const service = build();
		const bystander = createWindow(8);
		await service.acquire(7, 'test.exit');

		bystander.close();

		expect(service.isEngaged).toBe(true);
	});

	it('opens an external request only after the engaged window released', async () => {
		const service = build();
		await service.acquire(1, 'test.exit');

		const order: string[] = [];
		const handled = service.handleExternalOpen(
			() => order.push('open'),
			// The exit callback is fire-and-forget toward the renderer; the
			// release arrives later, the way a real exit reports back.
			() => queueMicrotask(() => {
				order.push('release');
				void service.release(1);
			})
		);

		await handled;

		expect(order).toEqual(['release', 'open']);
		expect(service.isEngaged).toBe(false);
	});

	it('stops waiting on a hung exit and opens anyway', async () => {
		vi.useFakeTimers();
		try {
			const service = build();
			await service.acquire(1, 'test.exit');

			const open = vi.fn();
			const exitMode = vi.fn(); // never releases
			const handled = service.handleExternalOpen(open, exitMode);

			await vi.advanceTimersByTimeAsync(EXTERNAL_OPEN_EXIT_WAIT);
			await handled;

			expect(exitMode).toHaveBeenCalledWith(1, 'test.exit');
			expect(open).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('opens immediately when the mode is not engaged', async () => {
		const service = build();
		const open = vi.fn();
		const exitMode = vi.fn();

		await service.handleExternalOpen(open, exitMode);

		expect(open).toHaveBeenCalledTimes(1);
		expect(exitMode).not.toHaveBeenCalled();
	});
});
