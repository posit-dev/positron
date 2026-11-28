/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { POSITRON_PREVIEW_HTML_VIEW_TYPE } from './positronPreviewSevice.js';
import { PreviewWebview } from './previewWebview.js';
import { IPreviewSurface } from './previewSurface.js';
import { ShowHtmlFileEvent } from '../../../services/languageRuntime/common/positronUiComm.js';

export const QUERY_NONCE_PARAMETER = '_positronRender';

/**
 * PreviewHtml is a class that represents a Positron `PreviewWebview` that
 * contains a preview of HTML content.
 */
export class PreviewHtml<S extends IPreviewSurface = IPreviewSurface> extends PreviewWebview<S> {

	/**
	 * Construct a new PreviewHtml.
	 *
	 * @param sessionId The session ID of the preview
	 * @param previewId A unique ID for the preview
	 * @param surface The webview or browser that shows the preview's content
	 * @param uri The URI to open in the preview
	 */
	constructor(
		readonly sessionId: string,
		previewId: string,
		surface: S,
		readonly uri: URI,
		readonly html?: ShowHtmlFileEvent
	) {
		super(POSITRON_PREVIEW_HTML_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_HTML_VIEW_TYPE,
			surface);

		// Perform the initial navigation.
		this.surface.loadUri(uri);
	}

	override get address(): URI {
		return this.uri;
	}
}
