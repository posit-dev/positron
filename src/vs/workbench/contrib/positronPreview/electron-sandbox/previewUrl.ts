/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { PreviewUrl } from 'vs/workbench/contrib/positronPreview/browser/previewUrl';

/**
 * Electron version of the Positron preview URL object.
 */
export class ElectronPreviewUrl extends PreviewUrl {

	/**
	 * Loads a URI in the preview's underlying webview.
	 *
	 * @param uri The URI to open in the preview
	 */
	protected override loadUri(uri: URI): void {
		// Load the URI in the webview. We can set the URI directly in Electron
		// mode instead of building an HTML string with an iframe.
		//
		// This is both more efficient and lets us inject scripts into the
		// webview to hook up copy/paste, link handling, etc.
		this.webview.setUri(uri);
	}
}
