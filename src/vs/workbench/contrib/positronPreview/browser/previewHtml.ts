/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { POSITRON_PREVIEW_URL_VIEW_TYPE } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PreviewOverlayWebview } from 'vs/workbench/contrib/positronPreview/browser/previewOverlayWebview';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { IShowHtmlUriEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';

export const QUERY_NONCE_PARAMETER = '_positronRender';

/**
 * PreviewUrl is a class that represents a Positron `PreviewWebview` that
 * contains a URL preview.
 */
export class PreviewHtml extends PreviewWebview {

	/**
	 * Construct a new PreviewWebview.
	 *
	 * @param previewId A unique ID for the preview
	 * @param webview The underlying webview instance that hosts the preview's content
	 * @param _uri The URI to open in the preview
	 */
	constructor(
		previewId: string,
		webview: PreviewOverlayWebview,
		private readonly _evt: IShowHtmlUriEvent
	) {
		super(POSITRON_PREVIEW_URL_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_URL_VIEW_TYPE,
			webview);

		// Perform the initial navigation.
		this.webview.loadUri(this._evt.uri);
	}
}
