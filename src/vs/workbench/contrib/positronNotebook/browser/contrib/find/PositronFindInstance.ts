/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';
// eslint-disable-next-line local/code-import-patterns
import { createRoot, Root } from 'react-dom/client';
import { PositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../../base/browser/positronReactServices.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
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
	private _root?: Root;
	private _mountPoint?: HTMLElement;

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

	public readonly isVisible: IObservable<boolean> = this._isVisible;
	public readonly inputFocused: IObservable<boolean> = this._inputFocused;

	constructor(
		private readonly _options: IPositronFindInstanceOptions
	) {
		super();

		this._register(runOnChange(this._isVisible, (visible) => {
			if (!visible) {
				// Clear match info when hiding
				transaction(() => {
					this.matchCount.set(undefined, undefined);
					this.matchIndex.set(undefined, undefined);
				});
			}
		}));
	}

	/**
	 * Dispose method - clean up React root and mount point
	 */
	public override dispose(): void {
		// Unmount React root
		this._root?.unmount();
		this._root = undefined;

		// Remove mount point from DOM
		this._mountPoint?.remove();
		this._mountPoint = undefined;

		super.dispose();
	}

	/**
	 * Gets or creates the React root for the find widget.
	 */
	private getOrCreateRenderer(): Root {
		if (!this._root) {
			// Create mount point div
			this._mountPoint = document.createElement('div');
			this._mountPoint.className = 'positron-find-widget-mount';

			// Append directly to notebook container (no modal overlay)
			this._options.container.appendChild(this._mountPoint);

			// Create React root
			this._root = createRoot(this._mountPoint);
		}

		return this._root;
	}

	/**
	 * Shows the find widget.
	 */
	public show(): void {
		// Get or create the renderer
		const root = this.getOrCreateRenderer();

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

		// Render the widget with services context
		root.render(
			React.createElement(
				PositronReactServicesContext.Provider,
				{ value: PositronReactServices.services },
				findWidget
			)
		);

		// Update visibility
		this._isVisible.set(true, undefined);
	}

	/**
	 * Hides the find widget.
	 */
	public hide(): void {
		this._isVisible.set(false, undefined);
	}
}
