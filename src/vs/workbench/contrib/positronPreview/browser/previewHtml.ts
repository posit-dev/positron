/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { POSITRON_PREVIEW_HTML_VIEW_TYPE } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PreviewOverlayWebview } from 'vs/workbench/contrib/positronPreview/browser/previewOverlayWebview';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { ShowHtmlFileEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';

export const QUERY_NONCE_PARAMETER = '_positronRender';

/**
 * PreviewHtml is a class that represents a Positron `PreviewWebview` that
 * contains a preview of HTML content.
 */
export class PreviewHtml extends PreviewWebview {

	/**
	 * Construct a new PreviewHtml.
	 *
	 * @param sessionId The session ID of the preview
	 * @param previewId A unique ID for the preview
	 * @param webview The underlying webview instance that hosts the preview's content
	 * @param uri The URI to open in the preview
	 */
	constructor(
		readonly sessionId: string,
		previewId: string,
		webview: PreviewOverlayWebview,
		readonly uri: URI,
		readonly html: ShowHtmlFileEvent
	) {
		super(POSITRON_PREVIEW_HTML_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_HTML_VIEW_TYPE,
			webview);

		// Perform the initial navigation.
		this.webview.loadUri(uri);
	}
}
