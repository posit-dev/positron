/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
/// <reference types="vitest/globals" />

import type { BrowserWindow, WebContents } from 'electron';
import { EventEmitter } from 'events';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { IFileService } from '../../../files/common/files.js';
import { ICodeWindow } from '../../../window/electron-main/window.js';
import { IWindowsMainService } from '../../../windows/electron-main/windows.js';
import { WebviewMainService } from '../../electron-main/webviewMainService.js';

const { fromId } = vi.hoisted(() => ({ fromId: vi.fn() }));

// Electron's native objects cannot be loaded in Vitest. Keep the real service
// and protocol provider; only stub their Electron boundary.
vi.mock('electron', () => ({
	webContents: { fromId },
	protocol: { handle: vi.fn(), unhandle: vi.fn() },
}));

function createContents(id: number) {
	const events = new EventEmitter();
	let destroyed = false;
	const writes: boolean[] = [];
	const contents: WebContents = stubInterface<WebContents>({
		id,
		isDestroyed: () => destroyed,
		setIgnoreMenuShortcuts: (enabled: boolean) => { writes.push(enabled); },
		once: (event: string, listener: Parameters<EventEmitter['once']>[1]) => { events.once(event, listener); return contents; },
		removeListener: (event: string, listener: Parameters<EventEmitter['removeListener']>[1]) => { events.removeListener(event, listener); return contents; },
	});
	return {
		contents, writes, events,
		destroy: () => { destroyed = true; events.emit('destroyed'); },
	};
}

describe('WebviewMainService menu shortcut ownership', () => {
	const windows = new Map<number, ICodeWindow>();
	const ctx = createTestContainer()
		.stub(IFileService, {})
		.stub(IWindowsMainService, { getWindowById: (id: number) => windows.get(id) })
		.build();

	beforeEach(() => {
		windows.clear();
		fromId.mockReset();
	});

	function setupWindow(windowId = 1, contentsId = 10) {
		const target = createContents(contentsId);
		windows.set(windowId, stubInterface<ICodeWindow>({
			win: stubInterface<BrowserWindow>({ webContents: target.contents }),
		}));
		return target;
	}

	function setupService() {
		return ctx.disposables.add(ctx.instantiationService.createInstance(WebviewMainService));
	}

	it('ignores A\'s late blur and disposal after B takes focus', async () => {
		const { writes, events } = setupWindow();
		const service = setupService();
		const a = { windowId: 1, webviewId: 'A' };
		const b = { windowId: 1, webviewId: 'B' };

		await service.setIgnoreMenuShortcuts(a, true);
		await service.setIgnoreMenuShortcuts(b, true);
		// Blur and ElectronWebviewElement.dispose() both send the same release.
		await service.setIgnoreMenuShortcuts(a, false);
		await service.setIgnoreMenuShortcuts(a, false);
		// The very next key must still see suppression, with no intervening false.
		expect({ writes, listeners: events.listenerCount('destroyed') }).toEqual({ writes: [true, true], listeners: 1 });
		await service.setIgnoreMenuShortcuts(b, false);
		expect(writes).toEqual([true, true, false]);
	});

	it('ignores disposal of a webview that never owned the target', async () => {
		const { writes, events } = setupWindow();
		const service = setupService();
		await service.setIgnoreMenuShortcuts({ windowId: 1, webviewId: 'A' }, false);
		expect({ writes, listeners: events.listenerCount('destroyed') }).toEqual({ writes: [], listeners: 0 });
	});

	it('releases on native editor focus even when the previous webview never blurred', async () => {
		const { writes } = setupWindow();
		const service = setupService();
		const a = { windowId: 1, webviewId: 'A' };
		const b = { windowId: 1, webviewId: 'B' };
		await service.setIgnoreMenuShortcuts(a, true);
		await service.setIgnoreMenuShortcuts(b, true);
		// B blurs to the workbench/editor; A's obsolete focus must not be retained.
		await service.setIgnoreMenuShortcuts(b, false);
		await service.setIgnoreMenuShortcuts(a, false);
		expect(writes).toEqual([true, true, false]);
	});

	it('releases a disposed owner once and removes its destruction listener', async () => {
		const { writes, events } = setupWindow();
		const service = setupService();
		const target = { windowId: 1, webviewId: 'A' };
		await service.setIgnoreMenuShortcuts(target, true);
		await service.setIgnoreMenuShortcuts(target, false);
		await service.setIgnoreMenuShortcuts(target, false);
		expect({ writes, listeners: events.listenerCount('destroyed') }).toEqual({ writes: [true, false], listeners: 0 });
	});

	it('keeps windows independent, including when webview IDs match', async () => {
		const first = setupWindow(1, 10);
		const second = setupWindow(2, 20);
		const service = setupService();
		const a = { windowId: 1, webviewId: 'A' };
		const b = { windowId: 2, webviewId: 'A' };
		await service.setIgnoreMenuShortcuts(a, true);
		await service.setIgnoreMenuShortcuts(b, true);
		await service.setIgnoreMenuShortcuts(a, false);
		expect({ first: first.writes, second: second.writes }).toEqual({ first: [true, false], second: [true] });
	});

	it('shares ownership across window and webContents target forms', async () => {
		const { contents, writes } = setupWindow();
		fromId.mockReturnValue(contents);
		const service = setupService();
		const a = { windowId: 1, webviewId: 'A' };
		const b = { webContentsId: 10, webviewId: 'B' };
		await service.setIgnoreMenuShortcuts(a, true);
		await service.setIgnoreMenuShortcuts(b, true);
		await service.setIgnoreMenuShortcuts(a, false);
		await service.setIgnoreMenuShortcuts(b, false);
		expect(writes).toEqual([true, true, false]);
	});

	it('cleans up destroyed contents and does not transfer ownership to a replacement window', async () => {
		const old = setupWindow();
		const removeListener = vi.spyOn(old.contents, 'removeListener');
		const service = setupService();
		const target = { windowId: 1, webviewId: 'A' };
		await service.setIgnoreMenuShortcuts(target, true);
		old.destroy();
		// Check explicit cleanup, not just EventEmitter's automatic once removal.
		expect(removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function));
		await service.setIgnoreMenuShortcuts(target, false);
		const replacement = setupWindow();
		await service.setIgnoreMenuShortcuts(target, false);
		service.dispose();
		expect({ old: old.writes, replacement: replacement.writes, listeners: old.events.listenerCount('destroyed') })
			.toEqual({ old: [true], replacement: [], listeners: 0 });
	});

	it('releases suppression and listeners when the service is disposed', async () => {
		const first = setupWindow(1, 10);
		const second = setupWindow(2, 20);
		const service = setupService();
		await service.setIgnoreMenuShortcuts({ windowId: 1, webviewId: 'A' }, true);
		await service.setIgnoreMenuShortcuts({ windowId: 2, webviewId: 'B' }, true);
		service.dispose();
		service.dispose();
		expect([first, second].map(({ writes, events }) => ({ writes, listeners: events.listenerCount('destroyed') })))
			.toEqual([{ writes: [true, false], listeners: 0 }, { writes: [true, false], listeners: 0 }]);
	});
});
// --- End Positron ---
