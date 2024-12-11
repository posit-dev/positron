/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { POSITRON_PREVIEW_URL_VIEW_TYPE } from './positronPreviewSevice.js';
import { PreviewOverlayWebview } from './previewOverlayWebview.js';
import { PreviewWebview } from './previewWebview.js';

export const QUERY_NONCE_PARAMETER = '_positronRender';

/**
 * PreviewUrl is a class that represents a Positron `PreviewWebview` that
 * contains a URL preview.
 */
export class PreviewUrl extends PreviewWebview {

	/**
	 * A nonce to append to the URI to ensure that the preview is not cached.
	 */
	private static _nonce = 0;

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
		private _uri: URI
	) {
		super(POSITRON_PREVIEW_URL_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_URL_VIEW_TYPE,
			webview);

		// Perform the initial navigation.
		this.navigateToUri(_uri);

		// Listen for navigation events.
		this.webview.onDidNavigate(e => {
			this._onDidNavigate.fire(e);
			this._uri = e;
		});
	}


	/**
	 * Navigate to a new URI in the preview.
	 *
	 * @param uri The URI to navigate to.
	 */
	public navigateToUri(uri: URI): void {
		this._uri = uri;

		// Amend a nonce to the URI for cache busting.
		const nonce = `${QUERY_NONCE_PARAMETER}=${(PreviewUrl._nonce++).toString(16)}`;
		const iframeUri = this._uri.with({
			query:
				uri.query ? uri.query + '&' + nonce : nonce
		});
		this.webview.loadUri(iframeUri);
	}

	public _onDidNavigate = this._register(new Emitter<URI>());
	public onDidNavigate = this._onDidNavigate.event;

	get currentUri(): URI {
		return this._uri;
	}
}
