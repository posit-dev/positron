/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronPreviewService } from '../browser/positronPreviewServiceImpl.js';
import { PreviewOverlayWebview } from '../browser/previewOverlayWebview.js';
import { ElectronPreviewOverlayWebview } from './previewOverlayWebview.js';
import { IOverlayWebview, WebviewExtensionDescription } from '../../webview/browser/webview.js';
import { URI } from '../../../../base/common/uri.js';
import { IPreviewSurface } from '../browser/previewSurface.js';
import { POSITRON_VIEWER_USE_INTEGRATED_BROWSER } from '../browser/positronPreviewSevice.js';
import { PreviewBrowserView } from './previewBrowserView.js';

/**
 * Electron version of the Positron preview service.
 */
export class ElectronPositronPreviewService extends PositronPreviewService {
	/**
	 * Electron override for creating preview URL objects; returns the Electron variant.
	 */
	protected override createOverlayWebview(
		webview: IOverlayWebview): PreviewOverlayWebview {
		return new ElectronPreviewOverlayWebview(webview);
	}

	protected override useIntegratedBrowser(): boolean {
		return this._configurationService.getValue<boolean>(POSITRON_VIEWER_USE_INTEGRATED_BROWSER) === true;
	}

	/**
	 * Shows content with an address in the integrated browser when the
	 * setting asks for it.
	 */
	protected override createAddressableSurface(
		viewType: string,
		uri: URI,
		extension: WebviewExtensionDescription | undefined): IPreviewSurface {
		if (this.useIntegratedBrowser()) {
			return this._instantiationService.createInstance(PreviewBrowserView);
		}
		return super.createAddressableSurface(viewType, uri, extension);
	}

	/**
	 * Electron override for external URI previewing; always returns true.
	 *
	 * @returns True
	 */
	protected override canPreviewExternalUri(): boolean {
		return true;
	}
}
