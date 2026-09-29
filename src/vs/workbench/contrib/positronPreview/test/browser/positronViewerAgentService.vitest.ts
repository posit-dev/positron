/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PreviewSourceType } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { IPositronPreviewService } from '../../browser/positronPreviewSevice.js';
import { PositronViewerAgentService } from '../../browser/positronViewerAgentService.js';
import { PreviewOverlayWebview, ViewerBridgeResult } from '../../browser/previewOverlayWebview.js';
import { PreviewUrl } from '../../browser/previewUrl.js';
import { PreviewWebview } from '../../browser/previewWebview.js';
import { IViewerCapture } from '../../browser/viewerScreenshot.js';
import { IViewerActOutcome, IViewerBridge, IViewerViewport } from '../../common/positronViewerAgent.js';

/**
 * A preview webview whose bridge and capture are scripted by the test, and
 * which records what the service asked for.
 */
class FakePreviewOverlayWebview extends PreviewOverlayWebview {
	readonly calls: string[] = [];
	viewport: IViewerViewport = { width: 600, height: 400 };
	/** When set, every bridge call fails with this, as when the page can't be reached. */
	bridgeError: Error | undefined;
	/** Runs during the capture, to change what the Viewer shows mid-call. */
	onCapture: (() => void) | undefined;
	actOutcome: IViewerActOutcome = { message: 'Clicked the button "Go".', navigated: false, timedOut: false };
	/** When set, the action fails with this, as when a control is disabled. */
	actError: Error | undefined;
	/** When set, snapshots fail with this, as when the page stops responding. */
	snapshotError: Error | undefined;

	constructor(size = { width: 600, height: 400 }, onDidLoad: Event<string> = Event.None) {
		super(stubInterface<IOverlayWebview>({
			onDidNavigate: Event.None,
			onDidDispose: Event.None,
			onDidLoad,
			dispose: () => { },
			container: stubInterface<HTMLElement>({ getBoundingClientRect: () => new DOMRect(0, 0, size.width, size.height) }),
		}));
	}

	protected override loadUriInWebview(): void { }

	override async runBridge<M extends keyof IViewerBridge>(method: M, ..._args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
		this.calls.push(method);
		if (this.bridgeError) {
			throw this.bridgeError;
		}
		if (method === 'act' && this.actError) {
			throw this.actError;
		}
		if (method === 'snapshot' && this.snapshotError) {
			throw this.snapshotError;
		}
		const results: { [K in keyof IViewerBridge]: ViewerBridgeResult<K> } = {
			waitForIdle: { waitedMs: 0, timedOut: false },
			snapshot: { text: '- button "Go" [ref=e1]', url: 'http://localhost:8000/?_positronRender=3', title: 'App', truncated: false },
			viewport: this.viewport,
			act: this.actOutcome,
		};
		return results[method];
	}

	override async captureScreenshot(): Promise<IViewerCapture> {
		this.calls.push('capture');
		this.onCapture?.();
		return { data: VSBuffer.fromString('png'), width: 600, height: 400, method: 'dom' };
	}
}

describe('PositronViewerAgentService', () => {
	const configurationService = new TestConfigurationService();
	let activePreview: PreviewWebview | undefined;
	let viewerVisible: boolean;
	const openView = vi.fn(async () => {
		viewerVisible = true;
		return null;
	});

	const ctx = createTestContainer()
		.stub(IConfigurationService, configurationService)
		.stub(IPositronPreviewService, {
			get activePreviewWebview() {
				return activePreview;
			},
		})
		.stub(IViewsService, {
			isViewVisible: () => viewerVisible,
			openView,
		})
		.build();

	beforeEach(() => {
		configurationService.setUserConfiguration('ai.enabled', true);
		activePreview = undefined;
		viewerVisible = true;
	});

	function createService(): PositronViewerAgentService {
		return ctx.instantiationService.createInstance(PositronViewerAgentService);
	}

	function showUrl(webview = new FakePreviewOverlayWebview()): FakePreviewOverlayWebview {
		// The preview owns and disposes its webview.
		activePreview = ctx.disposables.add(new PreviewUrl('previewUrl.1', webview,
			URI.parse('http://localhost:8000/?_positronRender=0'), { type: PreviewSourceType.Runtime, id: 'python-1' }));
		return webview;
	}

	it('describes an empty Viewer, or an app loaded from a URL without the Viewer\'s cache-busting parameter', () => {
		const service = createService();
		expect(service.getViewerInfo()).toEqual({ kind: 'none', visible: true });

		showUrl();
		viewerVisible = false;

		expect(service.getViewerInfo()).toEqual({
			kind: 'url',
			title: undefined,
			url: 'http://localhost:8000/',
			sourceSessionId: 'python-1',
			visible: false,
		});
	});

	it('reports the title of the page showing now, not of an earlier page', () => {
		const didLoad = ctx.disposables.add(new Emitter<string>());
		const webview = showUrl(new FakePreviewOverlayWebview(undefined, didLoad.event));
		const service = createService();
		const titles: (string | undefined)[] = [];

		didLoad.fire('Old Faithful');
		titles.push(service.getViewerInfo().title);
		// A page with no title.
		didLoad.fire('');
		titles.push(service.getViewerInfo().title);
		// A new page that hasn't finished loading.
		didLoad.fire('Old Faithful');
		webview.loadUri(URI.parse('http://localhost:8000/other'));
		titles.push(service.getViewerInfo().title);

		expect(titles).toEqual(['Old Faithful', undefined, undefined]);
	});

	it('refuses every call when AI features are turned off', async () => {
		configurationService.setUserConfiguration('ai.enabled', false);
		showUrl();
		const service = createService();

		expect(() => service.getViewerInfo()).toThrow(/AI features are turned off/);
		await expect(service.getViewerSnapshot()).rejects.toThrow(/AI features are turned off/);
		await expect(service.getViewerScreenshot()).rejects.toThrow(/AI features are turned off/);
		await expect(service.viewerAct({ kind: 'click', ref: 'e1' })).rejects.toThrow(/AI features are turned off/);
	});

	it('refuses when there\'s nothing it can read: an empty Viewer, or content such as notebook renderer output', async () => {
		const service = createService();
		await expect(service.getViewerSnapshot()).rejects.toThrow('Nothing is showing in the Viewer.');

		activePreview = ctx.disposables.add(new PreviewWebview('notebookRenderer', 'previewWebview.1', 'Python', new FakePreviewOverlayWebview()));

		await expect(service.getViewerSnapshot()).rejects.toThrow('Agents can\'t read this kind of Viewer content yet.');
	});

	it('snapshots once the app has settled', async () => {
		const webview = showUrl();

		const snapshot = await createService().getViewerSnapshot();

		expect(webview.calls).toEqual(['waitForIdle', 'snapshot']);
		expect(snapshot.url).toBe('http://localhost:8000/');
	});

	it('takes a screenshot without revealing a Viewer that is already showing', async () => {
		const webview = showUrl();

		const screenshot = await createService().getViewerScreenshot();

		expect(openView).not.toHaveBeenCalled();
		expect(webview.calls).toEqual(['viewport', 'waitForIdle', 'capture']);
		expect({ mimeType: screenshot.mimeType, method: screenshot.method, revealed: screenshot.revealed })
			.toEqual({ mimeType: 'image/png', method: 'dom', revealed: false });
	});

	it('reveals a hidden Viewer, without focus, and waits for the app to take its size', async () => {
		const webview = showUrl();
		viewerVisible = false;
		// The app is still laid out at the hidden Viewer's size until the first check.
		webview.viewport = { width: 300, height: 150 };
		openView.mockImplementationOnce(async () => {
			viewerVisible = true;
			webview.viewport = { width: 600, height: 400 };
			return null;
		});

		const screenshot = await createService().getViewerScreenshot();

		expect(openView).toHaveBeenCalledWith('workbench.panel.positronPreview', false);
		expect(screenshot.revealed).toBe(true);
		expect(webview.calls).toEqual(['viewport', 'viewport', 'waitForIdle', 'capture']);
	});

	it('fails rather than return a screenshot of content the Viewer has moved on from', async () => {
		const webview = showUrl();
		webview.onCapture = () => showUrl();

		await expect(createService().getViewerScreenshot()).rejects.toThrow('The Viewer\'s content changed while it was being read.');
	});

	it('fails rather than capture forever', async () => {
		vi.useFakeTimers();
		try {
			const webview = showUrl();
			webview.captureScreenshot = () => new Promise<IViewerCapture>(() => { });

			const screenshot = createService().getViewerScreenshot();
			const failed = expect(screenshot).rejects.toThrow('Taking the screenshot of the Viewer took too long.');
			await vi.advanceTimersByTimeAsync(31_000);
			await failed;
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves a hidden Viewer alone when the page can\'t be reached', async () => {
		const webview = showUrl();
		viewerVisible = false;
		webview.bridgeError = new Error('Agents can\'t read this kind of Viewer content yet, or it hasn\'t loaded.');

		await expect(createService().getViewerScreenshot()).rejects.toThrow('Agents can\'t read this kind of Viewer content yet');
		expect(openView).not.toHaveBeenCalled();
	});

	it('fails rather than capture an app that never takes the Viewer\'s size', async () => {
		vi.useFakeTimers();
		try {
			const webview = showUrl();
			// Stuck at the size of a hidden Viewer's frame in web builds.
			webview.viewport = { width: 300, height: 150 };

			const screenshot = createService().getViewerScreenshot();
			const failed = expect(screenshot).rejects.toThrow('The page in the Viewer is laid out at 300x150, not the Viewer\'s 600x400');
			await vi.advanceTimersByTimeAsync(4000);
			await failed;
			expect(webview.calls).not.toContain('capture');
		} finally {
			vi.useRealTimers();
		}
	});

	it('acts on a hidden Viewer after revealing it without focus, then snapshots the page', async () => {
		const webview = showUrl();
		viewerVisible = false;

		const result = await createService().viewerAct({ kind: 'click', ref: 'e1' });

		expect({ result, calls: webview.calls, reveals: openView.mock.calls }).toEqual({
			result: {
				message: 'Clicked the button "Go".',
				snapshot: { text: '- button "Go" [ref=e1]', url: 'http://localhost:8000/', title: 'App', truncated: false },
				timedOut: false,
				revealed: true,
			},
			calls: ['viewport', 'viewport', 'act', 'snapshot'],
			reveals: [['workbench.panel.positronPreview', false]],
		});
	});

	it('waits for the new page before the snapshot when an action goes to another address', async () => {
		const webview = showUrl();
		webview.actOutcome = { message: 'Clicked the link "Next". The page went to another address.', navigated: true, timedOut: false };

		await createService().viewerAct({ kind: 'click', ref: 'e1' });

		expect(webview.calls).toEqual(['viewport', 'act', 'viewport', 'waitForIdle', 'snapshot']);
	});

	it('reports an action it took even when there\'s no snapshot after it, so the agent doesn\'t take it again', async () => {
		const webview = showUrl();
		webview.snapshotError = new Error('The page in the Viewer stopped responding.');

		const result = await createService().viewerAct({ kind: 'click', ref: 'e1' });

		expect(result).toEqual({
			message: 'Clicked the button "Go". There\'s no snapshot of the page after it: The page in the Viewer stopped responding.',
			timedOut: false,
			revealed: false,
		});
	});

	it('passes on why an action couldn\'t be taken', async () => {
		const webview = showUrl();
		webview.actError = new Error('The button "Off" is disabled.');

		await expect(createService().viewerAct({ kind: 'click', ref: 'e2' })).rejects.toThrow('The button "Off" is disabled.');
		expect(webview.calls).toEqual(['viewport', 'act']);
	});

});
