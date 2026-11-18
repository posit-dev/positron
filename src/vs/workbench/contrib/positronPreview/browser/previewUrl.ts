/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { POSITRON_PREVIEW_URL_VIEW_TYPE } from './positronPreviewSevice.js';
import { PreviewWebview } from './previewWebview.js';
import { IPreviewSurface } from './previewSurface.js';

export const QUERY_NONCE_PARAMETER = '_positronRender';

/**
 * PreviewUrl is a class that represents a Positron `PreviewWebview` that
 * contains a URL preview.
 */
export class PreviewUrl<S extends IPreviewSurface = IPreviewSurface> extends PreviewWebview<S> {

	/**
	 * A nonce to append to the URI to ensure that the preview is not cached.
	 */
	private static _nonce = 0;

	/**
	 * Construct a new PreviewWebview.
	 *
	 * @param previewId A unique ID for the preview
	 * @param surface The webview or browser that shows the preview's content
	 * @param _uri The URI to open in the preview
	 * @param _source Optional source information indicating what opened the preview
	 */
	constructor(
		previewId: string,
		surface: S,
		private _uri: URI,
		private _source?: { type: string; id: string }
	) {
		super(POSITRON_PREVIEW_URL_VIEW_TYPE, previewId,
			POSITRON_PREVIEW_URL_VIEW_TYPE,
			surface);

		// Perform the initial navigation.
		this.navigateToUri(_uri);

		// Listen for navigation events, removing the cache-busting nonce,
		// which the user doesn't need to see or carry elsewhere.
		this._register(this.surface.onDidNavigate(e => {
			this._uri = e.with({
				query: e.query.split('&').filter(p => !p.startsWith(`${QUERY_NONCE_PARAMETER}=`)).join('&')
			});
			this._onDidNavigate.fire(this._uri);
		}));
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
		this.surface.loadUri(iframeUri);
	}

	public _onDidNavigate = this._register(new Emitter<URI>());
	public onDidNavigate = this._onDidNavigate.event;

	get currentUri(): URI {
		return this._uri;
	}

	override get address(): URI {
		return this._uri;
	}

	get source(): { type: string; id: string } | undefined {
		return this._source;
	}
}
