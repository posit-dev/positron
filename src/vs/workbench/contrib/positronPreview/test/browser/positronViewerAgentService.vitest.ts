/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
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
import { IViewerBridge, IViewerViewport } from '../../common/positronViewerAgent.js';

/**
 * A preview webview whose bridge and capture are scripted by the test, and
 * which records what the service asked for.
 */
class FakePreviewOverlayWebview extends PreviewOverlayWebview {
	readonly calls: string[] = [];
	viewport: IViewerViewport = { width: 600, height: 400 };

	constructor(size = { width: 600, height: 400 }) {
		super(stubInterface<IOverlayWebview>({
			onDidNavigate: Event.None,
			onDidDispose: Event.None,
			onDidLoad: Event.None,
			dispose: () => { },
			container: stubInterface<HTMLElement>({ getBoundingClientRect: () => new DOMRect(0, 0, size.width, size.height) }),
		}));
	}

	override loadUri(): void { }

	override async runBridge<M extends keyof IViewerBridge>(method: M, ..._args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
		this.calls.push(method);
		const results: { [K in keyof IViewerBridge]: ViewerBridgeResult<K> } = {
			waitForIdle: { waitedMs: 0, timedOut: false },
			snapshot: { text: '- button "Go" [ref=e1]', url: 'http://localhost:8000/?_positronRender=3', title: 'App', truncated: false },
			viewport: this.viewport,
		};
		return results[method];
	}

	override async captureScreenshot(): Promise<IViewerCapture> {
		this.calls.push('capture');
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

	it('describes an empty Viewer', () => {
		expect(createService().getViewerInfo()).toEqual({ kind: 'none', visible: true });
	});

	it('describes an app loaded from a URL, without the Viewer\'s cache-busting parameter', () => {
		showUrl();
		viewerVisible = false;

		expect(createService().getViewerInfo()).toEqual({
			kind: 'url',
			title: undefined,
			url: 'http://localhost:8000/',
			sourceSessionId: 'python-1',
			visible: false,
		});
	});

	it('refuses every call when AI features are turned off', async () => {
		configurationService.setUserConfiguration('ai.enabled', false);
		showUrl();
		const service = createService();

		expect(() => service.getViewerInfo()).toThrow(/AI features are turned off/);
		await expect(service.getViewerSnapshot()).rejects.toThrow(/AI features are turned off/);
		await expect(service.getViewerScreenshot()).rejects.toThrow(/AI features are turned off/);
	});

	it('explains when there is nothing to read', async () => {
		const service = createService();

		await expect(service.getViewerSnapshot()).rejects.toThrow('Nothing is showing in the Viewer.');
	});

	it('refuses content it can\'t read yet, such as notebook renderer output', async () => {
		activePreview = ctx.disposables.add(new PreviewWebview('notebookRenderer', 'previewWebview.1', 'Python', new FakePreviewOverlayWebview()));

		await expect(createService().getViewerSnapshot()).rejects.toThrow('Agents can\'t read this kind of Viewer content yet.');
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
		expect(webview.calls).toEqual(['viewport', 'waitForIdle', 'capture']);
	});
});
