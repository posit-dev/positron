/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewServiceImpl';
import { PreviewOverlayWebview } from 'vs/workbench/contrib/positronPreview/browser/previewOverlayWebview';
import { ElectronPreviewOverlayWebview } from 'vs/workbench/contrib/positronPreview/electron-sandbox/previewOverlayWebview';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';

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
