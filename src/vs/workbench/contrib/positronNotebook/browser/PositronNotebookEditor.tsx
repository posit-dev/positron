/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';

import {
	IReactComponentContainer,
	ISize,
	PositronReactRenderer,
} from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput';

import { Emitter, Event } from 'vs/base/common/event';
import { PositronNotebookComponent } from './PositronNotebookComponent';


//! Is this a good pattern for getting things into the react component when we don't have a
//! guarenteed order?
export type ValueAndSubscriber<T> = {
	value?: T;
	changeEvent: Event<T>;
};

export class PositronNotebookEditor
	extends EditorPane
	implements IReactComponentContainer {
	_parentDiv: HTMLElement | undefined;

	/**
	 * Gets or sets the PositronReactRenderer for the PositronNotebook component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	// fileNameDiv: HTMLElement | undefined;

	/**
	 * Gets or sets the width. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _width = 0;

	/**
	 * Gets or sets the height. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _height = 0;

	/**
	 * Gets the width.
	 */
	get width() {
		return this._width;
	}

	/**
	 * Gets the height.
	 */
	get height() {
		return this._height;
	}

	/**
	 * Gets the container visibility.
	 */
	get containerVisible() {
		return this.isVisible();
	}

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus() {
		this.focus();
	}

	/**
	 * The onFocused event emitter.
	 */
	private _onFocusedEmitter = this._register(new Emitter<void>());

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	/**
	 * The onSizeChanged event emitter.
	 */
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

	private _size: ValueAndSubscriber<ISize> = {
		value: undefined,
		changeEvent: this.onSizeChanged,
	};

	/**
	 * The onVisibilityChanged event emitter.
	 */
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> =
		this._onVisibilityChangedEmitter.event;


	/**
	 * The onSaveScrollPosition event emitter.
	 */
	private _onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	/**
	 * The onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void> =
		this._onSaveScrollPositionEmitter.event;

	/**
	 * The onRestoreScrollPosition event emitter.
	 */
	private _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	/**
	 * The onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void> =
		this._onRestoreScrollPositionEmitter.event;

	protected override createEditor(parent: HTMLElement): void {
		const myDiv = parent.ownerDocument.createElement('div');
		this._parentDiv = myDiv;

		myDiv.style.outline = '1px solid red';
		myDiv.style.padding = '20px';
		myDiv.style.backgroundColor = 'lightgrey';

		parent.appendChild(myDiv);
	}


	/**
	 * Disposes of the PositronReactRenderer for the PositronNotebook.
	 */
	private disposePositronReactRenderer() {
		// If the PositronReactRenderer for the PositronNotebook is exists, dispose it. This removes
		// the PositronNotebook from the DOM.
		console.log(`PositronDataEditor dispose PositronReactRenderer`);
		if (this._positronReactRenderer) {
			// Dispose of the PositronReactRenderer for the PositronNotebook.
			this._positronReactRenderer.dispose();
			this._positronReactRenderer = undefined;
		}
	}

	/**
	 * Clears the input.
	 */
	override clearInput(): void {
		console.log('~~~~~~ clearInput');

		this.disposePositronReactRenderer();

		// Call the base class's method.
		super.clearInput();
	}

	override layout(
		dimension: DOM.Dimension,
		position?: DOM.IDomPosition | undefined
	): void {
		// Size the container.
		console.log('layout', { dimension, position });

		if (!this._parentDiv) {
			return;
		}
		DOM.size(this._parentDiv, dimension.width, dimension.height);

		this._width = dimension.width;
		this._height = dimension.height;

		const updated_size = {
			width: this._width,
			height: this._height,
		};

		this._size.value = updated_size;
		this._onSizeChangedEmitter.fire(updated_size);
	}


	override async setInput(
		input: PositronNotebookEditorInput,
		options: unknown | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
		noRetry?: boolean
	): Promise<void> {
		console.log('setInput', { input, options, context, token, noRetry });

		this._input = input;

		if (!this._positronReactRenderer) {

			// throw new Error('Method not implemented.');\
			// Get the Positron data tool instance.
			if (!this._parentDiv) {
				throw new Error('No parent div. Somehow .setInput() has been called before .createEditor()');
			}
			this._positronReactRenderer = new PositronReactRenderer(this._parentDiv);
		}

		this._positronReactRenderer.render(
			<PositronNotebookComponent
				message='Hello Positron!'
				size={this._size}
				input={input}
			/>
		);
	}

	constructor(
		@IClipboardService readonly _clipboardService: IClipboardService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService
	) {
		// Call the base class's constructor.
		super(
			PositronNotebookEditorInput.EditorID,
			telemetryService,
			themeService,
			storageService
		);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose the PositronReactRenderer for the PositronNotebook.
		this.disposePositronReactRenderer();

		// Call the base class's dispose method.
		super.dispose();
	}
}
