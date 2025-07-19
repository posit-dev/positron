/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { PreviewOverlayWebview } from '../browser/previewOverlayWebview.js';

/**
 * Electron version of the Positron preview URL object.
 */
export class ElectronPreviewOverlayWebview extends PreviewOverlayWebview {

	/**
	 * Loads a URI in the preview's underlying webview.
	 *
	 * @param uri The URI to open in the preview
	 */
	public override loadUri(uri: URI): void {
		// Load the URI in the webview. We can set the URI directly in Electron
		// mode instead of building an HTML string with an iframe.
		//
		// This is both more efficient and lets us inject scripts into the
		// webview to hook up copy/paste, link handling, etc.
		this.webview.setUri(uri);
	}
}
