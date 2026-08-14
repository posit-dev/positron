/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { NullLogService } from '../../../log/common/log.js';
import { EXTERNAL_OPEN_EXIT_WAIT } from '../../common/positronStandaloneMode.js';
import { PositronStandaloneModeMainService } from '../../electron-main/positronStandaloneModeMainService.js';

// The service watches windows through electron's app; the tests drive those
// watchers by invoking the captured `browser-window-created` handler with a
// hand-made window, since electron's real objects cannot exist outside the
// main process. `browserWindows` backs BrowserWindow.fromId, which the
// service uses to reveal a window its released engagement left hidden.
const { electronApp, browserWindows } = vi.hoisted(() => ({
	electronApp: {
		listeners: new Map<string, (...args: unknown[]) => void>(),
		on(event: string, listener: (...args: unknown[]) => void) { this.listeners.set(event, listener); },
		removeListener(event: string) { this.listeners.delete(event); },
	},
	browserWindows: new Map<number, unknown>(),
}));
vi.mock('electron', () => ({
	app: electronApp,
	BrowserWindow: { fromId: (id: number) => browserWindows.get(id) ?? null },
}));

/** A window as far as the service's watchers are concerned. */
function createWindow(id: number, options?: { visible?: boolean }) {
	const windowListeners = new Map<string, (...args: unknown[]) => void>();
	const webContentsListeners = new Map<string, (...args: unknown[]) => void>();
	let visible = options?.visible ?? true;
	const show = vi.fn(() => { visible = true; });
	const window = {
		id,
		on: (event: string, listener: (...args: unknown[]) => void) => windowListeners.set(event, listener),
		webContents: { on: (event: string, listener: (...args: unknown[]) => void) => webContentsListeners.set(event, listener) },
		isDestroyed: () => false,
		isVisible: () => visible,
		show,
	};
	browserWindows.set(id, window);
	electronApp.listeners.get('browser-window-created')?.(undefined, window);
	return {
		show,
		isVisible: () => visible,
		close: () => {
			// Real electron drops a closed window from fromId's lookup.
			browserWindows.delete(id);
			windowListeners.get('closed')?.();
		},
		reload: () => webContentsListeners.get('did-navigate')?.(),
		crash: () => webContentsListeners.get('render-process-gone')?.(),
		failLoad: (errorCode: number, isMainFrame: boolean) =>
			webContentsListeners.get('did-fail-load')?.(undefined, errorCode, 'description', 'url', isMainFrame),
	};
}

describe('PositronStandaloneModeMainService', () => {
	const disposables = ensureNoLeakedDisposables();

	beforeEach(() => browserWindows.clear());

	function build(lifecycle: { quitRequested: boolean } = { quitRequested: false }) {
		return disposables.add(new PositronStandaloneModeMainService(
			new NullLogService(),
			stubInterface<ILifecycleMainService>(lifecycle)
		));
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

	it('releases the claim when the main frame fails to load, but not for aborted or subframe failures', async () => {
		const service = build();
		const window = createWindow(7);
		await service.acquire(7, 'test.exit');

		window.failLoad(-3, true); // aborted load
		expect(service.isEngaged).toBe(true);

		window.failLoad(-105, false); // subframe failure
		expect(service.isEngaged).toBe(true);

		window.failLoad(-105, true);
		expect(service.isEngaged).toBe(false);
	});

	it('shows the window a released engagement left hidden', async () => {
		for (const dropClaim of ['release', 'reload', 'crash', 'failLoad'] as const) {
			const service = build();
			const window = createWindow(7, { visible: false });
			await service.acquire(7, 'test.exit');

			if (dropClaim === 'release') {
				await service.release(7);
			} else if (dropClaim === 'failLoad') {
				window.failLoad(-105, true);
			} else {
				window[dropClaim]();
			}

			expect(window.isVisible(), `via ${dropClaim}`).toBe(true);
			browserWindows.clear();
		}
	});

	it('leaves an already visible window alone on release', async () => {
		const service = build();
		const window = createWindow(7, { visible: true });
		await service.acquire(7, 'test.exit');

		await service.release(7);

		expect(window.show).not.toHaveBeenCalled();
	});

	it('fires onDidChange when the claim drops with the window still visible; the native host abandons in-flight hides on it', async () => {
		for (const dropClaim of ['release', 'reload', 'crash'] as const) {
			const service = build();
			const window = createWindow(7, { visible: true });
			await service.acquire(7, 'test.exit');
			const changes = vi.fn();
			disposables.add(service.onDidChange(changes));

			if (dropClaim === 'release') {
				await service.release(7);
			} else {
				window[dropClaim]();
			}

			expect(changes, `via ${dropClaim}`).toHaveBeenCalledTimes(1);
			expect(window.show, `via ${dropClaim}`).not.toHaveBeenCalled();
			browserWindows.clear();
		}
	});

	it('does not show the hidden window when the app is quitting', async () => {
		const lifecycle = { quitRequested: false };
		const service = build(lifecycle);
		const window = createWindow(7, { visible: false });
		await service.acquire(7, 'test.exit');

		lifecycle.quitRequested = true;
		await service.release(7);

		expect(service.isEngaged).toBe(false);
		expect(window.show).not.toHaveBeenCalled();
	});

	it('survives releasing after the engaged window closed', async () => {
		const service = build();
		const window = createWindow(7, { visible: false });
		await service.acquire(7, 'test.exit');

		window.close();

		expect(service.isEngaged).toBe(false);
		expect(window.show).not.toHaveBeenCalled();
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
