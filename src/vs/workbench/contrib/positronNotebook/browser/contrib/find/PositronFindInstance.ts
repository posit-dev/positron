/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';
import * as DOM from '../../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { IObservable, observableValue, transaction } from '../../../../../../base/common/observable.js';
import { PositronFindWidget } from './PositronFindWidget.js';
import { IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { PositronReactRenderer } from '../../../../../../base/browser/positronReactRenderer.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';

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
	 * Context key service for scoped context keys.
	 */
	contextKeyService: IContextKeyService;

	/**
	 * Context view service for dropdowns and suggestions.
	 */
	contextViewService: IContextViewService;
}

/**
 * Manages a find session including state, UI rendering, and user action events.
 * Emits events for user actions (find next/previous, close) and exposes observable state.
 */
export class PositronFindInstance extends Disposable {
	private _container?: HTMLElement;
	private _renderer?: PositronReactRenderer;

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
	}

	public override dispose(): void {
		super.dispose();

		this._container?.remove();
	}

	/**
	 * Shows the find widget.
	 */
	public show(): void {
		// Only create renderer and widget on first show
		if (!this._renderer) {
			// Create widget container
			this._container = DOM.$('.positron-find-widget-container');

			// Append to parent container
			this._options.container.appendChild(this._container);

			// Create React renderer
			this._renderer = this._register(new PositronReactRenderer(this._container));

			// Create the find widget
			const findWidget = React.createElement(PositronFindWidget, {
				contextKeyService: this._options.contextKeyService,
				contextViewService: this._options.contextViewService,
				findInputOptions: this._options.findInputOptions,
				findText: this.searchString,
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
			this._renderer.render(findWidget);
		}

		transaction((tx) => {
			// Set visible state and request focus
			this._isVisible.set(true, tx);
			this._inputFocused.set(true, tx);
		});
	}

	/**
	 * Hides the find widget.
	 */
	public hide(): void {
		this._isVisible.set(false, undefined);
	}
}
