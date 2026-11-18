/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IBrowserViewLoadingEvent, IBrowserViewNavigationEvent } from '../../../../../platform/browserView/common/browserView.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IBrowserViewCDPService, IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../../../../../platform/browserView/common/cdp/types.js';
import { PreviewBrowserView } from '../../electron-browser/previewBrowserView.js';

const { hostVisibility } = vi.hoisted(() => ({ hostVisibility: [] as boolean[] }));

vi.mock('../../../browserView/electron-browser/webContentsViewHost.js', () => ({
	focusWebContentsViewContainer: () => { },
	WebContentsViewHost: class {
		readonly screenshotElement = document.createElement('div');
		readonly pauseElement = document.createElement('div');
		onContainerCreated() { }
		setModel() { }
		setVisible(visible: boolean) { hostVisibility.push(visible); }
		layout() { }
		dispose() { }
	},
}));

describe('PreviewBrowserView', () => {
	const cdpMessages = new Emitter<CDPResponse | CDPEvent>();
	let views: DeferredPromise<IBrowserViewModel>[];
	let created: string[];

	const ctx = createLightTestContainer()
		.stub(IBrowserViewWorkbenchService, {
			createExternalBrowserView: (url: string) => {
				created.push(url);
				const view = new DeferredPromise<IBrowserViewModel>();
				views.push(view);
				return view.p;
			}
		})
		// A page that navigates away before answering any script.
		.stub(IBrowserViewCDPService, {
			createSessionGroup: async () => 'group',
			destroySessionGroup: async () => { },
			onCDPMessage: () => cdpMessages.event,
			onDidDestroy: () => new Emitter<void>().event,
			sendCDPMessage: async (_groupId: string, { id, method }: CDPRequest) => queueMicrotask(() => cdpMessages.fire(
				method === 'Target.getTargets' ? { id, result: { targetInfos: [{ targetId: 't', type: 'page', vscodeBrowserViewId: 'view' }] } } :
					method === 'Target.attachToTarget' ? { id, result: { sessionId: 's' } } :
						{ id, error: { code: -32000, message: 'Execution context was destroyed.' } })),
		})
		.build();

	/** A browser view model whose events the test fires, recording what it's asked to do. */
	function createModel() {
		const navigate = ctx.disposables.add(new Emitter<IBrowserViewNavigationEvent>());
		const loading = ctx.disposables.add(new Emitter<IBrowserViewLoadingEvent>());
		const willDispose = ctx.disposables.add(new Emitter<void>());
		const calls: string[] = [];
		const model = stubInterface<IBrowserViewModel>({
			url: 'http://localhost:8000/',
			title: 'App',
			id: 'view',
			onDidNavigate: navigate.event,
			onDidChangeLoadingState: loading.event,
			onDidChangeFocus: ctx.disposables.add(new Emitter<never>()).event,
			onDidClose: ctx.disposables.add(new Emitter<void>()).event,
			onWillDispose: willDispose.event,
			loadURL: async url => { calls.push(`load ${url}`); },
			layout: async bounds => { calls.push(`layout ${JSON.stringify(bounds)}`); },
			dispose: () => { calls.push('dispose'); willDispose.fire(); },
		});
		return { model, calls, navigate, loading, willDispose };
	}

	/** Creates a surface showing `url`. Its view is created by completing `views[0]`. */
	function createSurface(url = 'http://localhost:8000/'): PreviewBrowserView {
		const surface = ctx.disposables.add(ctx.instantiationService.createInstance(PreviewBrowserView));
		surface.loadUri(URI.parse(url));
		return surface;
	}

	function createAnchor(): HTMLElement {
		const anchor = mainWindow.document.body.appendChild(mainWindow.document.createElement('div'));
		ctx.disposables.add({ dispose: () => anchor.remove() });
		return anchor;
	}

	beforeEach(() => {
		views = [];
		created = [];
		hostVisibility.length = 0;
	});

	it('creates the view on the address and lays out over its anchor once it exists', async () => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10.4, 20.6, 300.2, 200.9));
		const { model, calls } = createModel();
		const surface = createSurface('http://localhost:8000/app');
		surface.claim(undefined, createAnchor());

		await views[0].complete(model);

		expect({ created, calls }).toEqual({
			created: ['http://localhost:8000/app'],
			calls: [`layout ${JSON.stringify({ x: 10, y: 20, width: 300, height: 200, windowId: mainWindow.vscodeWindowId, zoomFactor: 1, cornerRadius: 0 })}`],
		});
		expect(hostVisibility.at(-1)).toBe(true);
	});

	it('loads an address given while the view is being created once it exists', async () => {
		const { model, calls } = createModel();
		const surface = createSurface('http://localhost:8000/a');
		surface.loadUri(URI.parse('http://localhost:8000/b'));

		await views[0].complete(model);

		expect({ created, calls }).toEqual({ created: ['http://localhost:8000/a'], calls: ['load http://localhost:8000/b'] });
	});

	it('creates the view again on reload when its first page failed to load', async () => {
		const surface = createSurface();
		await views[0].error(new Error('ERR_CONNECTION_REFUSED'));
		const loaded = vi.fn();
		ctx.disposables.add(surface.onDidLoad(loaded));

		surface.reload();
		await views[1].complete(createModel().model);

		expect({ created, loaded: loaded.mock.calls }).toEqual({ created: ['http://localhost:8000/', 'http://localhost:8000/'], loaded: [['App']] });
	});

	it('hides the view when released and shows it again when claimed', async () => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200));
		const surface = createSurface();
		await views[0].complete(createModel().model);
		const anchor = createAnchor();

		surface.claim(undefined, anchor);
		surface.release(undefined);
		surface.claim(undefined, anchor);

		expect(hostVisibility).toEqual([true, false, true]);
	});

	it('reports the first page, then navigation and loads that succeed', async () => {
		const { model, navigate, loading } = createModel();
		const surface = createSurface();
		const navigated: string[] = [];
		const loaded: string[] = [];
		ctx.disposables.add(surface.onDidNavigate(uri => navigated.push(uri.toString())));
		ctx.disposables.add(surface.onDidLoad(title => loaded.push(title)));
		await views[0].complete(model);

		navigate.fire({ url: 'http://localhost:8000/two', title: 'Two', canGoBack: true, canGoForward: false, certificateError: undefined });
		loading.fire({ loading: false, error: { url: 'http://localhost:8000/two', errorCode: -102, errorDescription: 'ERR_CONNECTION_REFUSED' } });
		loading.fire({ loading: false });

		expect({ navigated, loaded }).toEqual({ navigated: ['http://localhost:8000/', 'http://localhost:8000/two'], loaded: ['App', 'App'] });
	});

	it('disposes itself when its view goes away', async () => {
		const { model, willDispose } = createModel();
		const surface = createSurface();
		await views[0].complete(model);
		const disposed = vi.fn();
		ctx.disposables.add(surface.onDidDispose(disposed));

		willDispose.fire();

		expect(disposed).toHaveBeenCalledOnce();
	});

	it('disposes a view that arrives after the surface is gone', async () => {
		const { model, calls } = createModel();
		const surface = createSurface();
		surface.dispose();

		await views[0].complete(model);
		await timeout(0);

		expect(calls).toEqual(['dispose']);
	});

	it('reports an action cut off by the page going to another address as navigation', async () => {
		const surface = createSurface();
		await views[0].complete(createModel().model);

		const outcome = await surface.runBridge('act', { kind: 'click', ref: 'e1' });

		expect(outcome).toEqual({ message: 'The page went to another address during the action.', navigated: true, timedOut: false });
		await expect(surface.runBridge('viewport')).rejects.toThrow('The Viewer\'s content changed while it was being read. Try again.');
	});

	it('reports no title for a page without one, which Chromium titles with its address', async () => {
		const { model, loading } = createModel();
		const surface = createSurface();
		const loaded: string[] = [];
		ctx.disposables.add(surface.onDidLoad(title => loaded.push(title)));
		await views[0].complete(model);

		Object.assign(model, { url: 'http://127.0.0.1:9000/abc', title: '127.0.0.1:9000/abc' });
		loading.fire({ loading: false });

		expect({ loaded, title: surface.title }).toEqual({ loaded: ['App', ''], title: undefined });
	});
});
