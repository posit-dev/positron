/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronPreviewService } from '../browser/positronPreviewServiceImpl.js';
import { PreviewOverlayWebview } from '../browser/previewOverlayWebview.js';
import { ElectronPreviewOverlayWebview } from './previewOverlayWebview.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';

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

	/**
	 * Electron override for external URI previewing; always returns true.
	 *
	 * @returns True
	 */
	protected override canPreviewExternalUri(): boolean {
		return true;
	}
}
