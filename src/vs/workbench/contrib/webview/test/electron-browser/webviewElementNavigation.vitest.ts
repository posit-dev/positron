/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The events script is found through FileAccess, which needs a root to resolve from.
vi.hoisted(() => Object.assign(globalThis, {
	_VSCODE_FILE_ROOT: new URL('../../../../../..', import.meta.url).pathname
}));

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { IRemoteAuthorityResolverService } from '../../../../../platform/remote/common/remoteAuthorityResolver.js';
import { ITunnelService } from '../../../../../platform/tunnel/common/tunnel.js';
import { FrameNavigationEvent, IWebviewManagerService, WebviewFrameId } from '../../../../../platform/webview/common/webviewManagerService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { WebviewThemeDataProvider } from '../../browser/themeing.js';
import { ElectronWebviewElement } from '../../electron-browser/webviewElement.js';

class TestElectronWebviewElement extends ElectronWebviewElement {
	public get webviewId(): string { return this.id; }
}

const EVENTS_SCRIPT = '/* webview-events.js */';

describe('ElectronWebviewElement content frame navigation', () => {
	const onFrameNavigation = new Emitter<FrameNavigationEvent>();
	const tracked: number[] = [];
	const injected: WebviewFrameId[] = [];
	const service = stubInterface<IWebviewManagerService>({
		onFoundInFrame: Event.None,
		onFrameNavigation: onFrameNavigation.event,
		setIgnoreMenuShortcuts: async () => { },
		trackFrameNavigation: async ({ windowId }) => { tracked.push(windowId); },
		executeJavaScript: async (frameId, script) => {
			if (script === EVENTS_SCRIPT) {
				injected.push(frameId);
			}
		},
	});
	const channelStore = new DisposableStore();
	const channel = ProxyChannel.fromService(service, channelStore);

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IMainProcessService, {
			getChannel: () => ({
				listen: (event: string, args?: unknown) => channel.listen(undefined, event, args),
				call: (command: string, args?: unknown) => channel.call(undefined, command, args),
			}),
		})
		.stub(INativeHostService, { windowId: 42 })
		.stub(IRemoteAuthorityResolverService, {})
		.stub(ITunnelService, {})
		.stub(IFileService, { readFile: async () => ({ value: VSBuffer.fromString(EVENTS_SCRIPT) }) })
		.build();

	afterAll(() => {
		channelStore.dispose();
		onFrameNavigation.dispose();
	});

	beforeEach(() => {
		tracked.length = 0;
		injected.length = 0;
	});

	function createWebview() {
		const webview = ctx.disposables.add(ctx.instantiationService.createInstance(TestElectronWebviewElement, {
			title: undefined,
			options: { externalUri: true },
			contentOptions: {},
			extension: undefined,
		}, stubInterface<WebviewThemeDataProvider>({
			onThemeDataChanged: Event.None,
			getWebviewThemeData: () => ({ styles: {}, activeTheme: 'vscode-dark', themeLabel: '', themeId: '' }),
		})));
		const navigated: string[] = [];
		ctx.disposables.add(webview.onDidNavigate(uri => navigated.push(uri.toString(true))));
		return { webview, navigated };
	}

	function frame(routingId: number): WebviewFrameId {
		return { processId: 9, routingId, frameTreeNodeId: routingId + 100 };
	}

	function navigate(webviewId: string, frameId: WebviewFrameId, url: string, isSameDocument = false) {
		onFrameNavigation.fire({ webviewId, frameId, url, isSameDocument });
	}

	it('follows its content frame to wherever it lands, even a URL it didn\'t ask for', async () => {
		const { webview, navigated } = createWebview();
		webview.setUri(URI.parse('http://google.com/'));
		await vi.waitFor(() => expect(tracked).toEqual([42]));

		navigate(webview.webviewId, frame(3), 'https://www.google.com/');

		await vi.waitFor(() => expect(injected).toEqual([frame(3)]));
		expect({ navigated, frame: webview.getContentFrameId() }).toEqual({
			navigated: ['https://www.google.com/'],
			frame: frame(3),
		});
	});

	it('reports navigations within the page without injecting the events script again', async () => {
		const { webview, navigated } = createWebview();
		webview.setUri(URI.parse('http://127.0.0.1:8765/index.html'));
		navigate(webview.webviewId, frame(3), 'http://127.0.0.1:8765/index.html');
		await vi.waitFor(() => expect(injected).toHaveLength(1));

		navigate(webview.webviewId, frame(3), 'http://127.0.0.1:8765/pushed-route', true);
		navigate(webview.webviewId, frame(3), 'http://127.0.0.1:8765/pushed-route#section', true);

		await vi.waitFor(() => expect(navigated).toHaveLength(3));
		expect({ navigated, injected }).toEqual({
			navigated: [
				'http://127.0.0.1:8765/index.html',
				'http://127.0.0.1:8765/pushed-route',
				'http://127.0.0.1:8765/pushed-route#section',
			],
			injected: [frame(3)],
		});
	});

	it('ignores navigations in other webviews', async () => {
		const { webview, navigated } = createWebview();
		const other = createWebview();
		webview.setUri(URI.parse('http://127.0.0.1:8000/'));
		navigate(webview.webviewId, frame(3), 'http://127.0.0.1:8000/');
		await vi.waitFor(() => expect(navigated).toHaveLength(1));

		navigate(other.webview.webviewId, frame(5), 'http://127.0.0.1:9000/');

		await vi.waitFor(() => expect(other.navigated).toHaveLength(1));
		expect({ navigated, frame: webview.getContentFrameId() }).toEqual({
			navigated: ['http://127.0.0.1:8000/'],
			frame: frame(3),
		});
	});

	it('forgets the old page\'s frame when it loads a new URL', async () => {
		const { webview } = createWebview();
		webview.setUri(URI.parse('http://127.0.0.1:8000/'));
		navigate(webview.webviewId, frame(3), 'http://127.0.0.1:8000/');
		await vi.waitFor(() => expect(webview.getContentFrameId()).toEqual(frame(3)));

		webview.setUri(URI.parse('http://127.0.0.1:59999/'));
		expect(webview.getContentFrameId()).toBeUndefined();

		navigate(webview.webviewId, frame(4), 'http://127.0.0.1:59999/');
		await vi.waitFor(() => expect(webview.getContentFrameId()).toEqual(frame(4)));
	});
});
