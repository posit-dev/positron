/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter, Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
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
	return { getId: () => id, uri } as any;
}

/** Counts raw HTML webview creations */
function stubOutputWebviewService(): IPositronNotebookOutputWebviewService & { rawHtmlCreationCount: number; rawHtmlBaseUris: (URI | undefined)[] } {
	let count = 0;
	const rawHtmlBaseUris: (URI | undefined)[] = [];
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

suite('PositronWebviewPreloadService - addNotebookOutput rawHtml', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let service: IPositronWebviewPreloadService;
	let outputWebviewService: ReturnType<typeof stubOutputWebviewService>;
	const notebookInstance = stubNotebookInstance('nb-1');

	setup(() => {
		outputWebviewService = stubOutputWebviewService();

		const runtimeSessionService = {
			activeSessions: [],
			onWillStartSession: Event.None,
		} as unknown as IRuntimeSessionService;

		const ipyWidgetsService = {} as IPositronIPyWidgetsService;

		service = disposables.add(new PositronWebviewPreloadService(
			runtimeSessionService,
			outputWebviewService,
			ipyWidgetsService,
		));

		service.attachNotebookInstance(notebookInstance);
	});

	test('rawHtml parameter creates a raw HTML webview and returns display result', async () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'out-1',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe>') }],
			rawHtml: '<iframe src="map.html"></iframe>',
		});

		assert.ok(result, 'should return a result');
		assert.strictEqual(result!.preloadMessageType, 'display');
		assert.ok('webview' in result!, 'display result should have a webview');
		assert.strictEqual(outputWebviewService.rawHtmlCreationCount, 1);
		assert.strictEqual(outputWebviewService.rawHtmlBaseUris[0]?.toString(), URI.file('/workspace').toString());

		// Resolve the webview promise to check the ID
		const webview = await (result as any).webview;
		assert.strictEqual(webview.id, 'out-1');
		webview.dispose();
	});

	test('untitled notebooks do not set a base URI for raw HTML', () => {
		const untitledNotebook = stubNotebookInstance('nb-untitled', URI.from({ scheme: 'untitled', path: '/Untitled-1.ipynb' }));
		service.attachNotebookInstance(untitledNotebook);

		const result = service.addNotebookOutput({
			instance: untitledNotebook,
			outputId: 'out-untitled',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<iframe>') }],
			rawHtml: '<iframe src="map.html"></iframe>',
		});

		assert.ok(result, 'should return a result');
		assert.strictEqual(outputWebviewService.rawHtmlBaseUris[0], undefined);
	});

	test('without rawHtml, text/html output returns undefined (not a webview type)', () => {
		const result = service.addNotebookOutput({
			instance: notebookInstance,
			outputId: 'out-2',
			outputs: [{ mime: 'text/html', data: VSBuffer.fromString('<p>simple</p>') }],
		});

		assert.strictEqual(result, undefined, 'plain HTML should not create a webview');
		assert.strictEqual(outputWebviewService.rawHtmlCreationCount, 0);
	});
});
