/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { asWebviewUri } from '../../webview/common/webview.js';
import { WebviewInitInfo } from '../../webview/browser/webview.js';
import { PositronNotebookOutputWebviewService } from './notebookOutputWebviewServiceImpl.js';

suite('PositronNotebookOutputWebviewService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('raw HTML webviews use the notebook base URI for relative assets', async () => {
		let capturedInitInfo: WebviewInitInfo | undefined;
		let capturedHtml: string | undefined;

		const webviewService = {
			createWebviewOverlay(initInfo: WebviewInitInfo) {
				capturedInitInfo = initInfo;
				return {
					setHtml(html: string) {
						capturedHtml = html;
					},
				} as any;
			},
		};

		const instantiationService = {
			createInstance(_ctor: unknown, options: { id: string; sessionId: string; webview: unknown }) {
				return {
					id: options.id,
					sessionId: options.sessionId,
					webview: options.webview,
					onDidRender: Event.None,
					dispose() { },
				};
			},
		} as Partial<IInstantiationService> as IInstantiationService;

		const service = new PositronNotebookOutputWebviewService(
			webviewService as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			instantiationService,
		);

		const baseUri = URI.file('/workspace/maps');
		await service.createRawHtmlOutputWebview('output-1', '<iframe src="map.html"></iframe>', baseUri);

		assert.deepStrictEqual(
			capturedInitInfo?.contentOptions.localResourceRoots?.map(root => root.toString()),
			[baseUri.toString()],
		);
		assert.ok(capturedHtml?.includes(`<base href="${asWebviewUri(baseUri).toString(true)}/">`));
	});
});
