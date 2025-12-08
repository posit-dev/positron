/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { Disposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { observableValue, transaction } from '../../../../../../base/common/observable.js';
import { Toggle } from '../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget } from './PositronFindWidget.js';
import { IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';

/**
 * Options for configuring the PositronFindInstance.
 */
export interface IPositronFindInstanceOptions {
	/**
	 * The container element to render the find widget in.
	 * Should be the parent element of the target editor/view.
	 */
	container: HTMLElement;

	/**
	 * Options for the find input widget.
	 */
	findInputOptions: IFindInputOptions;

	/**
	 * Additional toggles to add to the find input.
	 */
	additionalToggles?: Toggle[];
}

/**
 * Manages a find session including state, UI rendering, and user action events.
 * Emits events for user actions (find next/previous, close) and exposes observable state.
 */
export class PositronFindInstance extends Disposable {
	private readonly _renderer = this._register(new MutableDisposable<PositronModalReactRenderer>());

	// Events for user actions
	private readonly _onDidRequestFindNext = this._register(new Emitter<void>());
	private readonly _onDidRequestFindPrevious = this._register(new Emitter<void>());
	private readonly _onDidRequestClose = this._register(new Emitter<void>());

	public readonly onDidRequestFindNext: Event<void> = this._onDidRequestFindNext.event;
	public readonly onDidRequestFindPrevious: Event<void> = this._onDidRequestFindPrevious.event;
	public readonly onDidRequestClose: Event<void> = this._onDidRequestClose.event;

	// Events for visibility and focus state
	private readonly _onDidShow = this._register(new Emitter<void>());
	private readonly _onDidHide = this._register(new Emitter<void>());
	private readonly _onDidFocusInput = this._register(new Emitter<void>());
	private readonly _onDidBlurInput = this._register(new Emitter<void>());

	public readonly onDidShow: Event<void> = this._onDidShow.event;
	public readonly onDidHide: Event<void> = this._onDidHide.event;
	public readonly onDidFocusInput: Event<void> = this._onDidFocusInput.event;
	public readonly onDidBlurInput: Event<void> = this._onDidBlurInput.event;

	// Observable state for find operations
	public readonly searchString = observableValue('findStateSearchString', '');
	public readonly isRegex = observableValue('findStateIsRegexActual', false);
	public readonly wholeWord = observableValue('findStateWholeWordActual', false);
	public readonly matchCase = observableValue('findStateMatchCaseActual', false);
	public readonly preserveCase = observableValue('findStatePreserveCaseActual', false);
	public readonly matchIndex = observableValue<number | undefined>('findStateMatchIndex', undefined);
	public readonly matchCount = observableValue<number | undefined>('findStateMatchCount', undefined);

	constructor(
		private readonly _options: IPositronFindInstanceOptions
	) {
		super();
	}

	/**
	 * Gets or creates the renderer for the find widget.
	 */
	private getOrCreateRenderer(): PositronModalReactRenderer {
		if (!this._renderer.value) {
			this._renderer.value = new PositronModalReactRenderer({
				container: this._options.container,
				disableCaptures: true, // permits the usage of the enter key where applicable
			});
		}

		return this._renderer.value;
	}

	/**
	 * Shows the find widget.
	 */
	public show(): void {
		// Get or create the renderer
		const renderer = this.getOrCreateRenderer();

		// Create the find widget
		const findWidget = React.createElement(PositronFindWidget, {
			findInputOptions: this._options.findInputOptions,
			findText: this.searchString,
			focusInput: true,
			matchCase: this.matchCase,
			matchWholeWord: this.wholeWord,
			useRegex: this.isRegex,
			matchIndex: this.matchIndex,
			matchCount: this.matchCount,
			onPreviousMatch: () => this._onDidRequestFindPrevious.fire(),
			onNextMatch: () => this._onDidRequestFindNext.fire(),
			onClose: () => this.hide(),
			onInputFocus: () => this._onDidFocusInput.fire(),
			onInputBlur: () => this._onDidBlurInput.fire(),
		});

		// Render the widget
		renderer.render(findWidget);

		// Fire show event
		this._onDidShow.fire();
	}

	/**
	 * Hides the find widget and fires the close event.
	 */
	public hide(): void {
		// Clear the renderer
		this._renderer.clear();

		// Fire hide event
		this._onDidHide.fire();

		// Fire the close event so implementations can clean up
		this._onDidRequestClose.fire();

		// Reset match state
		transaction((tx) => {
			this.matchCount.set(undefined, tx);
			this.matchIndex.set(undefined, tx);
		});
	}
}
