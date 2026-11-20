/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="@testing-library/jest-dom/vitest" />

// eslint-disable-next-line local/code-import-patterns -- Semantic DOM queries for the Viewer's native error state.
import { within } from '@testing-library/dom';
// eslint-disable-next-line local/code-import-patterns -- User events exercise the error state's Reload button.
import { userEvent } from '@testing-library/user-event';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IBrowserElementSelectionState, IBrowserViewLoadingEvent, IBrowserViewNavigationEvent, IElementData } from '../../../../../platform/browserView/common/browserView.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IBrowserViewCDPService, IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../../../../../platform/browserView/common/cdp/types.js';
import { PreviewBrowserView } from '../../electron-browser/previewBrowserView.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../services/lifecycle/common/lifecycle.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IStorageService, InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';

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
	const willShutdown = new Emitter<WillShutdownEvent>();
	/** The calls the surface made to the main process's browser views. */
	const mainCalls: string[] = [];
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
		.stub(ILifecycleService, { onWillShutdown: willShutdown.event })
		.stub(IMainProcessService, {
			getChannel: () => stubInterface<IChannel>({ call: async <T>(command: string, arg?: unknown) => { mainCalls.push(`${command} ${JSON.stringify(arg)}`); return undefined as T; } }),
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
		const selectElement = ctx.disposables.add(new Emitter<IElementData>());
		const zoom = ctx.disposables.add(new Emitter<void>());
		const calls: string[] = [];
		let selection: IBrowserElementSelectionState = { active: false, options: {} };
		const model = stubInterface<IBrowserViewModel>({
			url: 'http://localhost:8000/',
			title: 'App',
			id: 'view',
			onDidNavigate: navigate.event,
			onDidChangeLoadingState: loading.event,
			onDidChangeFocus: ctx.disposables.add(new Emitter<never>()).event,
			onDidClose: ctx.disposables.add(new Emitter<void>()).event,
			onWillDispose: willDispose.event,
			onDidSelectElement: selectElement.event,
			onDidChangeZoom: zoom.event,
			zoomFactor: 1,
			setDevice: async device => { calls.push(`device ${JSON.stringify(device)}`); },
			zoomIn: async () => { calls.push('zoomIn'); },
			get elementSelectionState() { return selection; },
			toggleElementSelection: async (enabled, options) => {
				calls.push(`select ${enabled} ${options?.mode}`);
				selection = { active: !!enabled, options: options ?? {} };
			},
			setElementComments: async update => { calls.push(`comments ${JSON.stringify(update)}`); },
			focus: async () => { calls.push('focus'); },
			loadURL: async url => { calls.push(`load ${url}`); },
			layout: async bounds => { calls.push(`layout ${JSON.stringify(bounds)}`); },
			dispose: () => { calls.push('dispose'); willDispose.fire(); },
		});
		return { model, calls, navigate, loading, willDispose, selectElement };
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
		ctx.instantiationService.stub(IStorageService, ctx.disposables.add(new InMemoryStorageService()));
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

	it('fits the page to the Viewer\'s width by laying it out wider and scaling it down, until the user zooms', async () => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 525, 200));
		const { model, calls } = createModel();
		const surface = createSurface();
		surface.setFitToWidth(true);
		surface.claim(undefined, createAnchor());
		await views[0].complete(model);

		await surface.zoomIn();

		const bounds = { x: 0, y: 0, width: 525, height: 200, windowId: mainWindow.vscodeWindowId, zoomFactor: 1, cornerRadius: 0 };
		expect(calls).toEqual([
			'device {}',
			`layout ${JSON.stringify({ ...bounds, emulation: { scale: 0.5 } })}`,
			'device undefined',
			`layout ${JSON.stringify(bounds)}`,
			'zoomIn',
		]);
	});

	it('loads an address given while the view is being created once it exists', async () => {
		const { model, calls } = createModel();
		const surface = createSurface('http://localhost:8000/a');
		surface.loadUri(URI.parse('http://localhost:8000/b'));

		await views[0].complete(model);

		expect({ created, calls }).toEqual({ created: ['http://localhost:8000/a'], calls: ['load http://localhost:8000/b'] });
	});

	it('shows why its first page failed to load, and creates the view again from Reload', async () => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200));
		const surface = createSurface();
		const anchor = createAnchor();
		surface.claim(undefined, anchor);
		await views[0].error(new Error('ERR_CONNECTION_REFUSED'));
		const loaded = vi.fn();
		ctx.disposables.add(surface.onDidLoad(loaded));

		expect(within(anchor).getByRole('alert')).toHaveTextContent('Failed to Load PageERR_CONNECTION_REFUSEDURL: http://localhost:8000/Reload');
		// The error is drawn in the view's container, which fills the Viewer.
		expect(within(anchor).getByRole('alert').closest('.browser-container')).toHaveStyle({ width: '300px', height: '200px' });

		await userEvent.click(within(anchor).getByRole('button', { name: 'Reload' }));
		await views[1].complete(createModel().model);

		expect({ created, loaded: loaded.mock.calls }).toEqual({ created: ['http://localhost:8000/', 'http://localhost:8000/'], loaded: [['App']] });
		expect(within(anchor).queryByRole('alert')).not.toBeInTheDocument();
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

	it('turns element selection on and off, passes on what the user picks, and removes a comment\'s pin', async () => {
		const { model, calls, selectElement } = createModel();
		const surface = createSurface();
		await views[0].complete(model);
		const picked: string[] = [];
		ctx.disposables.add(surface.onDidSelectElement(data => picked.push(data.outerHTML)));

		await surface.toggleElementSelection('comment');
		selectElement.fire({ outerHTML: '<button>Go</button>', computedStyle: '', bounds: { x: 0, y: 0, width: 1, height: 1 }, comment: 'Bigger', elementId: 'c1' });
		surface.discardElementComment('c1');
		await surface.toggleElementSelection('comment');
		await surface.toggleElementSelection('select');

		expect({ calls, picked }).toEqual({
			calls: [
				'select true comment',
				'focus',
				'comments {"comments":[],"pendingCommentIdsToDiscard":["c1"]}',
				'select false comment',
				'select true select',
				'focus',
			],
			picked: ['<button>Go</button>'],
		});
	});

	it('destroys its view before the window reloads or closes, since nothing takes it back', async () => {
		const surface = createSurface();
		await views[0].complete(createModel().model);
		const joined: Promise<void>[] = [];

		willShutdown.fire(stubInterface<WillShutdownEvent>({ join: (promise: Promise<void> | (() => Promise<void>)) => { joined.push(promise as Promise<void>); } }));
		await Promise.all(joined);
		surface.dispose();

		expect({ joined: joined.length, mainCalls }).toEqual({ joined: 1, mainCalls: ['destroyBrowserView ["view"]'] });
	});
});
