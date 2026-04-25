/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { asWebviewUri } from '../../webview/common/webview.js';
import { IOverlayWebview, IWebviewService, WebviewInitInfo } from '../../webview/browser/webview.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { INotebookRendererMessagingService } from '../../notebook/common/notebookRendererMessagingService.js';
import { PositronNotebookOutputWebviewService } from './notebookOutputWebviewServiceImpl.js';

describe('PositronNotebookOutputWebviewService', () => {
	ensureNoLeakedDisposables();

	it('raw HTML webviews use the notebook base URI for relative assets', async () => {
		let capturedInitInfo: WebviewInitInfo | undefined;
		let capturedHtml: string | undefined;

		const createWebviewOverlay = (initInfo: WebviewInitInfo): IOverlayWebview => {
			capturedInitInfo = initInfo;
			return stubInterface<IOverlayWebview>({
				setHtml(html: string) {
					capturedHtml = html;
				},
			});
		};

		const webviewService = stubInterface<IWebviewService>({ createWebviewOverlay });

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
			webviewService,
			stubInterface<INotebookService>({}),
			stubInterface<IWorkspaceTrustManagementService>({}),
			stubInterface<INotebookRendererMessagingService>({}),
			stubInterface<ILogService>({}),
			instantiationService,
		);

		const baseUri = URI.file('/workspace/maps');
		await service.createRawHtmlOutputWebview('output-1', '<iframe src="map.html"></iframe>', baseUri);

		expect(
			capturedInitInfo?.contentOptions.localResourceRoots?.map(root => root.toString()),
		).toEqual([baseUri.toString()]);
		expect(capturedHtml?.includes(`<base href="${asWebviewUri(baseUri).toString(true)}/">`)).toBeTruthy();
	});
});
