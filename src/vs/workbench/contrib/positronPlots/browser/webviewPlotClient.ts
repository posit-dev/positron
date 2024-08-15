/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { VSBuffer, encodeBase64 } from 'vs/base/common/buffer';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IOverlayWebview } from 'vs/workbench/contrib/webview/browser/webview';
import { IPositronPlotMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

/**
 * A Positron plot instance that is backed by a webview.
 */
export class WebviewPlotClient extends Disposable implements IPositronPlotClient {


	private _thumbnail: VSBuffer | undefined;

	private _onDidRenderThumbnail: Emitter<string>;

	private _claimed: boolean = false;

	private _renderTimer: NodeJS.Timeout | undefined;

	private _element: HTMLElement | undefined;

	/**
	 * Creates a new WebPlotClient, which wraps a notebook output webview in
	 * an object that can be displayed in the Plots pane.
	 *
	 * @param webview The webview to wrap.
	 * @param message The output message from which the webview was created.
	 * @param code The code that generated the webview (if known)
	 */
	constructor(
		public readonly metadata: IPositronPlotMetadata,
		public readonly webview: IOverlayWebview) {
		super();

		// Ensure that the webview is disposed when the plot client is disposed.
		this._register(webview);

		this._onDidRenderThumbnail = this._register(new Emitter<string>());
		this.onDidRenderThumbnail = this._onDidRenderThumbnail.event;
	}

	get id(): string {
		return this.metadata.id;
	}

	/**
	 * Gets the data URI representing the thumbnail (suitable for use as the
	 * `src` property of an `<image>` tag), or `undefined` if the thumbnail has
	 * not been rendered.
	 */
	get thumbnailUri(): string | undefined {
		if (this._thumbnail) {
			return this.asDataUri(this._thumbnail);
		}
		return undefined;
	}

	/**
	 * Claims the underlying webview.
	 *
	 * @param claimant The object taking ownership.
	 */
	public claim(claimant: any) {
		this.webview.claim(claimant, DOM.getWindow(this._element), undefined);
		this._claimed = true;
	}

	/**
	 * Lays the webview out over an element.
	 *
	 * @param ele The element over which to position the webview.
	 */
	public layoutWebviewOverElement(ele: HTMLElement) {
		this._element = ele;
		this.webview.layoutWebviewOverElement(ele);
	}

	/**
	 * Claims the underlying webview.
	 *
	 * @param claimant The object releasing ownership.
	 */
	public release(claimant: any) {
		this.webview.release(claimant);
		this._claimed = false;

		// We can't render a thumbnail while the webview isn't showing, so cancel the
		// timer if it's running.
		this.cancelPendingRender();
	}

	/**
	 * Renders a thumbnail for the webview by taking a screenshot of it (using
	 * Electron APIs in desktop mode) as PNG.
	 */
	private renderThumbnail() {
		this.webview.captureContentsAsPng().then(data => {
			if (data) {
				this._thumbnail = data;
				this._onDidRenderThumbnail.fire(this.asDataUri(data));
			}
		});
	}

	/**
	 * Nudge the render timer; debounces requests to render the plot thumbnail.
	 */
	protected nudgeRenderThumbnail() {
		// Cancel any pending render
		this.cancelPendingRender();

		// Start a new render timer; when it expires, we will take a screenshot
		// of the plot to use as a thumbnail.
		this._renderTimer = setTimeout(() => {
			if (this._claimed) {
				this.renderThumbnail();
			}
		}, 1000);
	}

	private cancelPendingRender() {
		if (this._renderTimer) {
			clearTimeout(this._renderTimer);
			this._renderTimer = undefined;
		}
	}

	private asDataUri(buffer: VSBuffer) {
		return `data:image/png;base64,${encodeBase64(buffer)}`;
	}

	/**
	 * Fires when the plot thumbnail has been rendered. The event's data is the
	 * data URI of the rendered thumbnail.
	 */
	public readonly onDidRenderThumbnail: Event<string>;

	override dispose(): void {
		// Process disposable store
		super.dispose();

		// Cancel any pending render operation.
		this.cancelPendingRender();
	}
}
