/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { INotebookRendererInfo, RendererMessagingSpec } from '../../notebook/common/notebookCommon.js';
import { ILanguageRuntimeMessageWebOutput } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronNotebookOutputWebviewService } from './notebookOutputWebviewServiceImpl.js';
import { FILL_VIEWPORT_CSS } from './fillViewport.js';

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

		const instantiationService = stubInterface<IInstantiationService>({
			createInstance: ((_ctor: unknown, options: { id: string; sessionId: string; webview: unknown }) => ({
				id: options.id,
				sessionId: options.sessionId,
				webview: options.webview,
				onDidRender: Event.None,
				dispose() { },
			})) as IInstantiationService['createInstance'],
		});

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
		expect(capturedHtml).toBeDefined();
		expect(capturedHtml).toContain(`<base href="${asWebviewUri(baseUri).toString(true)}/">`);
	});

	describe('fill viewport', () => {
		const createService = () => {
			const htmls: string[] = [];
			const webviewService = stubInterface<IWebviewService>({
				createWebviewOverlay: () => stubInterface<IOverlayWebview>({
					setHtml(html: string) { htmls.push(html); },
				}),
			});
			const renderer = stubInterface<INotebookRendererInfo>({
				id: 'renderer',
				extensionId: new ExtensionIdentifier('renderer.ext'),
				entrypoint: { path: URI.file('/renderer/index.js'), extends: undefined },
				messaging: RendererMessagingSpec.Never,
			});
			const service = new PositronNotebookOutputWebviewService(
				webviewService,
				stubInterface<INotebookService>({
					getPreferredRenderer: () => renderer,
					getRenderers: () => [],
					getStaticPreloads: () => [],
				}),
				stubInterface<IWorkspaceTrustManagementService>({ isWorkspaceTrusted: () => true }),
				stubInterface<INotebookRendererMessagingService>({ getScoped: () => stubInterface({}) }),
				stubInterface<ILogService>({}),
				stubInterface<IInstantiationService>({
					createInstance: (() => ({ onDidInitialize: Event.None, dispose() { } })) as IInstantiationService['createInstance'],
				}),
			);
			return { service, htmls };
		};

		it.each([
			{ fillViewport: true, expected: true },
			{ fillViewport: undefined, expected: false },
		])('fillViewport=$fillViewport adds the fill CSS: $expected', async ({ fillViewport, expected }) => {
			const { service, htmls } = createService();
			await service.createNotebookOutputWebview({
				id: 'output-1',
				runtime: stubInterface<ILanguageRuntimeSession>({ sessionId: 'session-1' }),
				output: stubInterface<ILanguageRuntimeMessageWebOutput>({ id: 'output-1', data: { 'text/html': '' }, resource_roots: [], output_location: undefined }),
				fillViewport,
			});

			expect(htmls).toHaveLength(1);
			expect(htmls[0].includes(FILL_VIEWPORT_CSS)).toBe(expected);
		});
	});
});
