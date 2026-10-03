/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { IViewerBridge } from '../common/positronViewerAgent.js';
import { PreviewOverlayWebview, ViewerBridgeResult } from '../browser/previewOverlayWebview.js';
import { viewerBridgeScript } from '../browser/viewerBridge.js';
import { IViewerCapture, scaleNativeScreenshot } from '../browser/viewerScreenshot.js';

type ViewerBridgeScriptResult<M extends keyof IViewerBridge> =
	{ ok: true; value: ViewerBridgeResult<M> } |
	{ ok: false; error: string };

/**
 * Electron version of the Positron preview URL object.
 */
export class ElectronPreviewOverlayWebview extends PreviewOverlayWebview {

	/** The bridge runs in the frame the webview loaded a URI in, and an HTML string has none. */
	public override readonly canReadHtmlStrings = false;

	/**
	 * Loads a URI in the preview's underlying webview.
	 *
	 * @param uri The URI to open in the preview
	 */
	protected override loadUriInWebview(uri: URI): void {
		// Load the URI in the webview. We can set the URI directly in Electron
		// mode instead of building an HTML string with an iframe.
		//
		// This is both more efficient and lets us inject scripts into the
		// webview to hook up copy/paste, link handling, etc.
		this.webview.setUri(uri);
	}

	/**
	 * On Desktop the app's frame is cross-origin from Positron, so the bridge
	 * is sent as a script and run in that frame by the main process. The
	 * script runs in the page's own JavaScript world, which the page can
	 * tamper with.
	 */
	protected override async callBridge<M extends keyof IViewerBridge>(method: M, args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
		const frameId = this.webview.getContentFrameId();
		if (!frameId) {
			throw new Error('Agents can\'t read this kind of Viewer content yet, or it hasn\'t loaded.');
		}
		const result: ViewerBridgeScriptResult<M> | undefined =
			await this.webview.executeJavaScript(frameId, viewerBridgeScript(method, args));
		if (!result) {
			throw new Error('The Viewer\'s content didn\'t respond.');
		}
		if (!result.ok) {
			throw new Error(result.error);
		}
		return result.value;
	}

	/**
	 * Captures what's on screen in the webview's area of the window. Anything
	 * drawn over the Viewer, such as a menu, is captured too.
	 */
	protected override async capture(): Promise<IViewerCapture> {
		const png = await this.webview.captureContentsAsPng();
		if (!png) {
			throw new Error('Could not capture the Viewer.');
		}
		return scaleNativeScreenshot(png, getWindow(this.webview.container));
	}

	/**
	 * Gets the address of the app's frame from the main process, which
	 * follows the page's history changes too.
	 */
	public override async getCurrentUrl(): Promise<string | undefined> {
		const frameId = this.webview.getContentFrameId();
		return frameId ? this.webview.getFrameUrl(frameId) : undefined;
	}
}
