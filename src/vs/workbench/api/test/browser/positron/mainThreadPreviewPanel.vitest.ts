/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IPositronPreviewService } from '../../../../contrib/positronPreview/browser/positronPreviewSevice.js';
import { PreviewOverlayWebview } from '../../../../contrib/positronPreview/browser/previewOverlayWebview.js';
import { PreviewWebview } from '../../../../contrib/positronPreview/browser/previewWebview.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { MainThreadWebviews } from '../../../browser/mainThreadWebviews.js';
import { MainThreadPreviewPanel } from '../../../browser/positron/mainThreadPreviewPanel.js';
import { ExtHostPreviewPanelShape } from '../../../common/positron/extHost.positron.protocol.js';

describe('MainThreadPreviewPanel stop button', () => {
	const disposables = ensureNoLeakedDisposables();
	const handle = 'preview-1';

	/** Creates a main thread preview panel and records the stop requests it sends to the ext host. */
	function createPanel(): { mainThread: MainThreadPreviewPanel; preview: PreviewWebview; webviewDisposed: Emitter<void>; stopRequests: string[] } {
		const stopRequests: string[] = [];
		const webviewDisposed = disposables.add(new Emitter<void>());
		const proxy = stubInterface<ExtHostPreviewPanelShape>({
			$onDidRequestStop: requestHandle => { stopRequests.push(requestHandle); },
			$onDidDisposePreviewPanel: async () => { },
		});
		const preview = disposables.add(new PreviewWebview('test.view', handle, 'Test', stubInterface<PreviewOverlayWebview>({
			webview: undefined,
			onDidDispose: webviewDisposed.event,
			dispose: () => { },
		})));
		const mainThread = disposables.add(new MainThreadPreviewPanel(
			stubInterface<IExtHostContext>({ getProxy: (<T>() => proxy as T) as IExtHostContext['getProxy'] }),
			stubInterface<MainThreadWebviews>({ addWebview: () => { } }),
			disposables.add(new InMemoryStorageService()),
			stubInterface<IPositronPreviewService>({ openPreview: () => preview }),
			stubInterface<IViewsService>({}),
		));
		mainThread.$createPreviewPanel(
			{ id: new ExtensionIdentifier('test.extension'), location: URI.file('/test') },
			handle,
			'test.view',
			{ title: 'Test', webviewOptions: {} },
			true,
		);
		return { mainThread, preview, webviewDisposed, stopRequests };
	}

	it('sends a stop request to the extension when the user clicks stop', () => {
		const { mainThread, preview, stopRequests } = createPanel();
		mainThread.$setStoppable(handle, true);

		preview.requestStop();

		expect(stopRequests).toEqual([handle]);
	});

	it('stops forwarding stop requests once the preview\'s webview is disposed', () => {
		const { preview, webviewDisposed, stopRequests } = createPanel();

		webviewDisposed.fire();
		preview.stoppable = true;
		preview.requestStop();

		expect(stopRequests).toEqual([]);
	});
});
