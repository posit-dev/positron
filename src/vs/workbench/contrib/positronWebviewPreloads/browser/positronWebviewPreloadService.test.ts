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

/** Minimal stub for IPositronNotebookInstance */
function stubNotebookInstance(id: string): IPositronNotebookInstance {
	return { getId: () => id } as any;
}

/** Counts raw HTML webview creations */
function stubOutputWebviewService(): IPositronNotebookOutputWebviewService & { rawHtmlCreationCount: number } {
	let count = 0;
	return {
		_serviceBrand: undefined,
		get rawHtmlCreationCount() { return count; },
		createRawHtmlOutputWebview(id: string, _html: string): Promise<INotebookOutputWebview> {
			count++;
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

		// Resolve the webview promise to check the ID
		const webview = await (result as any).webview;
		assert.strictEqual(webview.id, 'out-1');
		webview.dispose();
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
