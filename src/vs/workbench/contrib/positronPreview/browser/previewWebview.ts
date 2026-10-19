/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { PreviewOverlayWebview } from './previewOverlayWebview.js';

/**
 * This class represents a Positron preview webview as actually loaded into the
 * preview pane. The `PositronPreviewService` holds instances of this class for
 * each preview and loads them into the UI as needed.
 *
 * See `ExtHostPreviewPanel` for the class that represents the webview in the
 * extension host and tracks most of the state below.
 */
export class PreviewWebview extends Disposable {

	private _disposed = false;

	private _visible = false;

	private _active = false;

	private _stoppable = false;

	private _onDidChangeActiveState = new Emitter<boolean>();
	private _onDidChangeVisibleState = new Emitter<boolean>();
	private readonly _onDidChangeStoppable = this._register(new Emitter<boolean>());
	private readonly _onDidRequestStop = this._register(new Emitter<void>());

	/**
	 * Construct a new PreviewWebview.
	 *
	 * @param viewType The view type of the preview
	 * @param previewId A unique ID for the preview
	 * @param name The preview's name
	 * @param webview The underlying webview instance that hosts the preview's content
	 */
	constructor(
		readonly viewType: string,
		readonly previewId: string,
		readonly name: string,
		readonly webview: PreviewOverlayWebview
	) {
		super();

		this.onDidChangeActiveState = this._onDidChangeActiveState.event;
		this.onDidChangeVisibleState = this._onDidChangeVisibleState.event;

		// Ensure that the webview is disposed when the preview is disposed.
		this._register(this.webview);
	}

	/**
	 * Fires when the preview's active state changes. Only one preview can be
	 * active at a time; note that active doesn't necessarily mean visible (a
	 * preview could be active but hidden).
	 */
	onDidChangeActiveState: Event<boolean>;

	/**
	 * Fires when the preview's visibility changes. Only the active preview
	 * receives visibility events; these events track the state of the Preview
	 * pane itself.
	 */
	onDidChangeVisibleState: Event<boolean>;

	/**
	 * Fires when the preview's stoppable state changes.
	 */
	readonly onDidChangeStoppable: Event<boolean> = this._onDidChangeStoppable.event;

	/**
	 * Fires when the user asks to stop the process that serves the preview.
	 */
	readonly onDidRequestStop: Event<void> = this._onDidRequestStop.event;

	isDisposed(): boolean {
		return this._disposed;
	}

	get active(): boolean {
		return this._active;
	}

	set active(active: boolean) {
		this._active = active;
		this._onDidChangeActiveState.fire(active);
	}

	get visible(): boolean {
		return this._visible;
	}

	set visible(visible: boolean) {
		this._visible = visible;
		this._onDidChangeActiveState.fire(visible);
	}

	/**
	 * Whether the Viewer shows a stop button for this preview. The preview's
	 * owner (usually an extension) sets this while its process is running.
	 */
	get stoppable(): boolean {
		return this._stoppable;
	}

	set stoppable(stoppable: boolean) {
		if (this._stoppable !== stoppable) {
			this._stoppable = stoppable;
			this._onDidChangeStoppable.fire(stoppable);
		}
	}

	/**
	 * Hides the stop button and asks the preview's owner to stop.
	 */
	requestStop() {
		if (this._stoppable) {
			this.stoppable = false;
			this._onDidRequestStop.fire();
		}
	}

	override dispose() {
		super.dispose();
		this._disposed = true;
	}
}
