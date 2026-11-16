/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---

import type { BrowserWindow, WebContents, WebFrameMain } from 'electron';
import { EventEmitter } from 'events';
import { createLightTestContainer } from '../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { IFileService } from '../../../files/common/files.js';
import { ICodeWindow } from '../../../window/electron-main/window.js';
import { IWindowsMainService } from '../../../windows/electron-main/windows.js';
import { FrameNavigationEvent } from '../../common/webviewManagerService.js';
import { WebviewMainService } from '../../electron-main/webviewMainService.js';

const { fromId, frameFromId } = vi.hoisted(() => ({ fromId: vi.fn(), frameFromId: vi.fn() }));

// Electron's native objects cannot be loaded in Vitest. Keep the real service
// and protocol provider; only stub their Electron boundary.
vi.mock('electron', () => {
	const electron = {
		webContents: { fromId },
		webFrameMain: { fromId: frameFromId },
		protocol: { handle: vi.fn(), unhandle: vi.fn() },
	};
	// The service reads both named exports and the default export (`electron.webContents`).
	return { ...electron, default: electron };
});

function createContents(id: number) {
	const events = new EventEmitter();
	let destroyed = false;
	const writes: boolean[] = [];
	const contents: WebContents = stubInterface<WebContents>({
		id,
		isDestroyed: () => destroyed,
		setIgnoreMenuShortcuts: (enabled: boolean) => { writes.push(enabled); },
		on: (event: string, listener: Parameters<EventEmitter['on']>[1]) => { events.on(event, listener); return contents; },
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
	const ctx = createLightTestContainer()
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
			win: stubInterface<BrowserWindow>({ isDestroyed: () => false, webContents: target.contents }),
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

	it('releases suppression on main-frame navigation only', async () => {
		const { writes, events } = setupWindow();
		const service = setupService();
		await service.setIgnoreMenuShortcuts({ windowId: 1, webviewId: 'A' }, true);
		events.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
		events.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
		expect(writes).toEqual([true]);
		events.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
		expect({ writes, listeners: events.eventNames() }).toEqual({ writes: [true, false], listeners: [] });
	});

	it('releases suppression when the render process is gone', async () => {
		const { writes, events } = setupWindow();
		const service = setupService();
		await service.setIgnoreMenuShortcuts({ windowId: 1, webviewId: 'A' }, true);
		events.emit('render-process-gone');
		expect({ writes, listeners: events.eventNames() }).toEqual({ writes: [true, false], listeners: [] });
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

describe('WebviewMainService frame navigation', () => {
	const ctx = createLightTestContainer()
		.stub(IFileService, {})
		.stub(IWindowsMainService, { getWindowById: () => window })
		.build();

	const target = createContents(10);
	const window = stubInterface<ICodeWindow>({
		win: stubInterface<BrowserWindow>({
			isDestroyed: () => false,
			webContents: Object.assign(target.contents, {
				off: (event: string, listener: Parameters<EventEmitter['off']>[1]) => { target.events.off(event, listener); return target.contents; },
			}),
		}),
	});

	// A frame tree like the one Positron builds: the workbench, a webview's
	// host frame (index-external.html) named after the webview, the frame the
	// webview loaded a URL into, and a frame inside that page.
	const frames = new Map<number, WebFrameMain>();
	function addFrame(routingId: number, url: string, parent: WebFrameMain | null, name = '') {
		const frame = stubInterface<WebFrameMain>({ url, parent, name, frameTreeNodeId: routingId + 100 });
		frames.set(routingId, frame);
		return frame;
	}
	const workbench = addFrame(1, 'vscode-file://vscode-app/workbench.html', null);
	const viewerHost = addFrame(2, 'vscode-webview://abc/index-external.html?id=viewer', workbench, 'viewer');
	addFrame(3, 'http://127.0.0.1:8000/', viewerHost);
	const app = frames.get(3)!;
	addFrame(4, 'http://127.0.0.1:8000/embedded', app);
	// A webview that writes its own HTML loads it into a vscode-webview:// frame.
	const htmlHost = addFrame(5, 'vscode-webview://def/index.html?id=html', workbench, 'html');
	const htmlContent = addFrame(6, 'vscode-webview://def/fake.html', htmlHost);
	addFrame(7, 'https://example.com/', htmlContent);

	async function setupService() {
		frameFromId.mockImplementation((_processId: number, routingId: number) => frames.get(routingId));
		const service = ctx.disposables.add(ctx.instantiationService.createInstance(WebviewMainService));
		const events: FrameNavigationEvent[] = [];
		ctx.disposables.add(service.onFrameNavigation(e => events.push(e)));
		await service.trackFrameNavigation({ windowId: 1 });
		return { service, events };
	}

	function navigate(routingId: number, url: string) {
		target.events.emit('did-frame-navigate', {}, url, 200, 'OK', false, 9, routingId);
	}

	function navigateInPage(routingId: number, url: string) {
		target.events.emit('did-navigate-in-page', {}, url, false, 9, routingId);
	}

	it('reports navigations of a webview\'s content frame wherever they lead', async () => {
		const { events } = await setupService();
		navigate(3, 'http://127.0.0.1:8000/');
		// A redirect from what was asked for, and a page that failed to load.
		navigate(3, 'https://www.google.com/');
		navigate(3, 'http://127.0.0.1:59999/');
		expect(events).toEqual(['http://127.0.0.1:8000/', 'https://www.google.com/', 'http://127.0.0.1:59999/'].map(url => ({
			webviewId: 'viewer',
			frameId: { processId: 9, routingId: 3, frameTreeNodeId: 103 },
			url,
			isSameDocument: false,
		})));
	});

	it('reports navigations within the page, as with pushState or a #hash link', async () => {
		const { events } = await setupService();
		navigateInPage(3, 'http://127.0.0.1:8000/pushed-route');
		navigateInPage(3, 'http://127.0.0.1:8000/pushed-route#section');
		expect(events.map(e => ({ url: e.url, isSameDocument: e.isSameDocument }))).toEqual([
			{ url: 'http://127.0.0.1:8000/pushed-route', isSameDocument: true },
			{ url: 'http://127.0.0.1:8000/pushed-route#section', isSameDocument: true },
		]);
	});

	it('ignores frames that aren\'t a webview\'s loaded URL', async () => {
		const { events } = await setupService();
		navigate(1, 'vscode-file://vscode-app/workbench.html');
		navigate(2, 'vscode-webview://abc/index-external.html?id=viewer');
		navigate(4, 'http://127.0.0.1:8000/embedded');
		navigateInPage(4, 'http://127.0.0.1:8000/embedded#x');
		navigate(6, 'vscode-webview://def/fake.html');
		navigate(7, 'https://example.com/');
		navigate(8, 'http://127.0.0.1:8000/gone');
		expect(events).toEqual([]);
	});

	it('listens to each window once and stops when disposed', async () => {
		const { service } = await setupService();
		await service.trackFrameNavigation({ windowId: 1 });
		const counts = () => ['did-frame-navigate', 'did-navigate-in-page'].map(e => target.events.listenerCount(e));
		expect(counts()).toEqual([1, 1]);
		service.dispose();
		expect(counts()).toEqual([0, 0]);
	});
});
// --- End Positron ---
