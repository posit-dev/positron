/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { Disposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { IObservable, observableValue, runOnChange, transaction } from '../../../../../../base/common/observable.js';
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

	public readonly onDidRequestFindNext = this._onDidRequestFindNext.event;
	public readonly onDidRequestFindPrevious = this._onDidRequestFindPrevious.event;

	// Observable state for find operations
	public readonly searchString = observableValue('findStateSearchString', '');
	public readonly isRegex = observableValue('findStateIsRegexActual', false);
	public readonly wholeWord = observableValue('findStateWholeWordActual', false);
	public readonly matchCase = observableValue('findStateMatchCaseActual', false);
	public readonly preserveCase = observableValue('findStatePreserveCaseActual', false);
	public readonly matchIndex = observableValue<number | undefined>('findStateMatchIndex', undefined);
	public readonly matchCount = observableValue<number | undefined>('findStateMatchCount', undefined);

	// Observable state for visibility and focus
	private readonly _isVisible = observableValue('findStateIsVisible', false);
	private readonly _inputFocused = observableValue('findStateInputFocused', false);

	constructor(
		private readonly _options: IPositronFindInstanceOptions
	) {
		super();

		this._register(runOnChange(this._isVisible, (visible) => {
			if (!visible) {
				// Clear the renderer
				this._renderer.clear();

				// Clear match info when hiding
				transaction(() => {
					this.matchCount.set(undefined, undefined);
					this.matchIndex.set(undefined, undefined);
				});
			}
		}));
	}

	public get isVisible(): IObservable<boolean> {
		return this._isVisible;
	}

	public get inputFocused(): IObservable<boolean> {
		return this._inputFocused;
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
			inputFocused: this._inputFocused,
			isVisible: this._isVisible,
			matchCase: this.matchCase,
			matchWholeWord: this.wholeWord,
			useRegex: this.isRegex,
			matchIndex: this.matchIndex,
			matchCount: this.matchCount,
			onPreviousMatch: () => this._onDidRequestFindPrevious.fire(),
			onNextMatch: () => this._onDidRequestFindNext.fire(),
		});

		// Render the widget
		renderer.render(findWidget);

		// Update visibility
		this._isVisible.set(true, undefined);
	}

	/**
	 * Hides the find widget.
	 */
	public hide(): void {
		// TODO: Make isVisible public readonly?
		this._isVisible.set(false, undefined);
	}
}
