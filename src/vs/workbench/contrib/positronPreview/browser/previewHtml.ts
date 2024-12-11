/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { POSITRON_PREVIEW_HTML_VIEW_TYPE } from './positronPreviewSevice.js';
import { PreviewOverlayWebview } from './previewOverlayWebview.js';
import { PreviewWebview } from './previewWebview.js';
import { ShowHtmlFileEvent } from '../../../services/languageRuntime/common/positronUiComm.js';

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
		readonly html?: ShowHtmlFileEvent
	) {
		super(POSITRON_PREVIEW_HTML_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_HTML_VIEW_TYPE,
			webview);

		// Perform the initial navigation.
		this.webview.loadUri(uri);
	}
}
