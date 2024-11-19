/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { VSBuffer, encodeBase64 } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { IPositronPlotMetadata } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotClient } from '../../../services/positronPlots/common/positronPlots.js';

/**
 * A Positron plot instance that is backed by a webview.
 */
export abstract class WebviewPlotClient extends Disposable implements IPositronPlotClient {

	protected readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());

	private _thumbnail: VSBuffer | undefined;

	private _onDidActivate: Emitter<void>;

	private _onDidRenderThumbnail: Emitter<string>;

	private _claimed: boolean = false;

	private _renderTimer: NodeJS.Timeout | undefined;

	private _element: HTMLElement | undefined;

	private _pendingActivation?: Promise<void>;

	/**
	 * Creates a new NotebookOutputPlotClient, which manages the lifecycle of a
	 * webview, wrapped in an object that can be displayed in the Plots pane.
	 *
	 * @param metadata The metadata associated with the plot.
	 */
	constructor(public readonly metadata: IPositronPlotMetadata) {
		super();

		this._onDidActivate = this._register(new Emitter<void>());
		this.onDidActivate = this._onDidActivate.event;

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

	/** Whether the plot's underlying webview is active. */
	isActive(): boolean {
		return Boolean(this._webview.value);
	}

	/**
	 * Creates the underlying webview.
	 **/
	protected abstract createWebview(): Promise<IOverlayWebview>;

	/**
	 * Disposes the underlying webview.
	 **/
	protected abstract disposeWebview(): void;

	/**
	 * Activates the plot, creating the underlying webview if needed.
	 **/
	public activate() {
		// If we're already active, do nothing.
		if (this._webview.value) {
			return Promise.resolve();
		}

		// If we're already activating, return the existing promise.
		if (this._pendingActivation) {
			return this._pendingActivation;
		}

		// Otherwise, create the webview and fire the activation event.
		this._pendingActivation = this.createWebview().then((webview) => {
			this._webview.value = webview;
			this._onDidActivate.fire();
		}).finally(() => {
			this._pendingActivation = undefined;
		});
		return this._pendingActivation;
	}

	/**
	 * Deactivates the plot, disposing the underlying webview if needed.
	 **/
	public deactivate() {
		if (!this._webview.value) {
			// Already inactive, do nothing.
			return;
		}
		this.disposeWebview();
		this._webview.clear();
	}

	/**
	 * Claims the underlying webview.
	 *
	 * @param claimant The object taking ownership.
	 */
	public claim(claimant: any) {
		if (!this._webview.value) {
			throw new Error('No webview to claim');
		}
		this._webview.value.claim(claimant, DOM.getWindow(this._element), undefined);
		this._claimed = true;
	}

	/**
	 * Lays the webview out over an element.
	 *
	 * @param ele The element over which to position the webview.
	 */
	public layoutWebviewOverElement(ele: HTMLElement) {
		if (!this._webview.value) {
			throw new Error('No webview to layout');
		}
		this._element = ele;
		this._webview.value.layoutWebviewOverElement(ele);
	}

	/**
	 * Claims the underlying webview.
	 *
	 * @param claimant The object releasing ownership.
	 */
	public release(claimant: any) {
		if (!this._webview.value) {
			// Webview is already disposed so there's nothing to release.
			return;
		}
		this._webview.value.release(claimant);
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
		if (!this._webview.value) {
			throw new Error('No webview to render thumbnail');
		}
		this._webview.value.captureContentsAsPng().then(data => {
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
	 * Fires when the plot has been activated.
	 */
	public readonly onDidActivate: Event<void>;

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
