/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { PositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewServiceImpl';
import { PreviewUrl } from 'vs/workbench/contrib/positronPreview/browser/previewUrl';
import { ElectronPreviewUrl } from 'vs/workbench/contrib/positronPreview/electron-sandbox/previewUrl';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * Electron version of the Positron preview service.
 */
export class ElectronPositronPreviewService extends PositronPreviewService {
	/**
	 * Electron override for creating preview URL objects; returns the Electron variant.
	 */
	protected override createPreviewUrl(
		previewId: string,
		webview: IOverlayWebview,
		uri: URI): PreviewUrl {
		return new ElectronPreviewUrl(previewId, webview, uri);
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
