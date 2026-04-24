/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { mock } from '../../../../base/test/common/mock.js';
import { IPositronWebviewPreloadService } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { PositronWebviewPreloadService } from './positronWebviewPreloadsService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookOutputWebviewService, INotebookOutputWebview } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronIPyWidgetsService } from '../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { URI } from '../../../../base/common/uri.js';

/** Minimal stub for IPositronNotebookInstance */
function stubNotebookInstance(id: string, uri = URI.file('/workspace/notebook.ipynb')): IPositronNotebookInstance {
	// eslint-disable-next-line local/code-no-any-casts -- test fixture: IPositronNotebookInstance has many fields; typed stub deferred to follow-up cleanup PR
	return { getId: () => id, uri } as any;
}

/** Counts raw HTML webview creations */
function stubOutputWebviewService(): IPositronNotebookOutputWebviewService & { rawHtmlCreationCount: number; rawHtmlBaseUris: (URI | undefined)[] } {
	let count = 0;
	const rawHtmlBaseUris: (URI | undefined)[] = [];
	// eslint-disable-next-line local/code-no-any-casts -- test fixture: IPositronNotebookOutputWebviewService is wide; typed stub deferred to follow-up cleanup PR
	return {
		_serviceBrand: undefined,
		get rawHtmlCreationCount() { return count; },
		rawHtmlBaseUris,
		createRawHtmlOutputWebview(id: string, _html: string, baseUri?: URI): Promise<INotebookOutputWebview> {
			count++;
			rawHtmlBaseUris.push(baseUri);
			const onDidRender = new Emitter<void>();
			return Promise.resolve({
				id,
				sessionId: id,
				webview: {} as IOverlayWebview,
				onDidRender: onDidRender.event,
				dispose() { onDidRender.dispose(); },
			});
		},
		createNotebookOutputWebview: () => Promise.resolve(undefined),
		createMultiMessageWebview: () => Promise.resolve(undefined),
	} as any;
}

describe('PositronWebviewPreloadService - addNotebookOutput rawHtml', () => {
	const disposables = ensureNoLeakedDisposables();

	let service: IPositronWebviewPreloadService;
	let outputWebviewService: ReturnType<typeof stubOutputWebviewService>;
	const notebookInstance = stubNotebookInstance('nb-1');

	beforeEach(() => {
		outputWebviewService = stubOutputWebviewService();

		const runtimeSessionService = new class extends mock<IRuntimeSessionService>() {
			override activeSessions = [];
			override onWillStartSession = Event.None;
		};

		const ipyWidgetsService = new class extends mock<IPositronIPyWidgetsService>() { };

		service = disposables.add(new PositronWebviewPreloadService(
			runtimeSessionService,
			outputWebviewService,
			ipyWidgetsService,
		));

		service.attachNotebookInstance(notebookInstance);
	});

	it('rawHtml parameter creates a raw HTML webview and returns display result', async () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'out-1',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe>') }],
			rawHtml: '<iframe src="map.html"></iframe>',
		});

		expect(result, 'should return a result').toBeDefined();
		expect(result!.preloadMessageType).toBe('display');
		expect('webview' in result!, 'display result should have a webview').toBe(true);
		expect(outputWebviewService.rawHtmlCreationCount).toBe(1);
		expect(outputWebviewService.rawHtmlBaseUris[0]?.toString()).toBe(URI.file('/workspace').toString());

		// Resolve the webview promise to check the ID
		// eslint-disable-next-line local/code-no-any-casts -- addNotebookOutput's result is a union and we're narrowing to the display variant's webview field; typed narrowing deferred to follow-up cleanup PR
		const webview = await (result as any).webview;
		expect(webview.id).toBe('out-1');
		webview.dispose();
	});

	it('untitled notebooks do not set a base URI for raw HTML', () => {
		const untitledNotebook = stubNotebookInstance('nb-untitled', URI.from({ scheme: 'untitled', path: '/Untitled-1.ipynb' }));
		service.attachNotebookInstance(untitledNotebook);

		const result = service.addNotebookOutput({
			instance: untitledNotebook,
			outputId: 'out-untitled',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe>') }],
			rawHtml: '<iframe src="map.html"></iframe>',
		});

		expect(result, 'should return a result').toBeDefined();
		expect(outputWebviewService.rawHtmlBaseUris[0]).toBe(undefined);
	});

	it('without rawHtml, text/html output returns undefined (not a webview type)', () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'out-2',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<p>simple</p>') }],
		});

		expect(result, 'plain HTML should not create a webview').toBe(undefined);
		expect(outputWebviewService.rawHtmlCreationCount).toBe(0);
	});
});
