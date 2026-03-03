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
import { PositronFindWidget, PositronFindWidgetHandle, type PositronFindWidgetReplaceProps } from './PositronFindWidget.js';
import type { IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import type { IReplaceInputOptions } from '../../../../../../base/browser/ui/findinput/replaceInput.js';
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
	 * Options for the replace input widget. If undefined, the replace UI is disabled.
	 */
	replaceInputOptions?: IReplaceInputOptions;

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
	private readonly _widgetRef = React.createRef<PositronFindWidgetHandle>();

	// Events for user actions
	private readonly _onDidRequestFindNext = this._register(new Emitter<void>());
	private readonly _onDidRequestFindPrevious = this._register(new Emitter<void>());
	private readonly _onDidRequestReplace = this._register(new Emitter<void>());
	private readonly _onDidRequestReplaceAll = this._register(new Emitter<void>());

	public readonly onDidRequestFindNext = this._onDidRequestFindNext.event;
	public readonly onDidRequestFindPrevious = this._onDidRequestFindPrevious.event;
	public readonly onDidRequestReplace = this._onDidRequestReplace.event;
	public readonly onDidRequestReplaceAll = this._onDidRequestReplaceAll.event;

	// Observable state for find operations
	public readonly searchString = observableValue('findStateSearchString', '');
	public readonly isRegex = observableValue('findStateIsRegexActual', false);
	public readonly wholeWord = observableValue('findStateWholeWordActual', false);
	public readonly matchCase = observableValue('findStateMatchCaseActual', false);
	public readonly preserveCase = observableValue('findStatePreserveCaseActual', false);
	public readonly matchIndex = observableValue<number | undefined>('findStateMatchIndex', undefined);
	public readonly matchCount = observableValue<number | undefined>('findStateMatchCount', undefined);

	// Observable state for replace operations
	public readonly replaceText = observableValue('findStateReplaceText', '');
	public readonly replaceIsVisible = observableValue('findStateReplaceExpanded', false);

	// Observable state for visibility and focus
	private readonly _isVisible = observableValue('findStateIsVisible', false);
	private readonly _inputFocused = observableValue('findStateInputFocused', false);
	private readonly _replaceInputFocused = observableValue('findStateReplaceInputFocused', false);

	public readonly isVisible: IObservable<boolean> = this._isVisible;
	public readonly inputFocused: IObservable<boolean> = this._inputFocused;
	public readonly replaceInputFocused: IObservable<boolean> = this._replaceInputFocused;

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
	 * @param options.replace If true, expands the replace section.
	 */
	public show(options?: { replace?: boolean }): void {
		// Only create renderer and widget on first show
		if (!this._renderer) {
			// Create widget container
			this._container = DOM.$('.positron-find-widget-container');

			// Append to parent container
			this._options.container.appendChild(this._container);

			// Create React renderer
			this._renderer = this._register(new PositronReactRenderer(this._container));

			// Build replace props if replace input options are provided
			let replaceProps: PositronFindWidgetReplaceProps | undefined;
			if (this._options.replaceInputOptions) {
				replaceProps = {
					isVisible: this.replaceIsVisible,
					replaceText: this.replaceText,
					preserveCase: this.preserveCase,
					replaceInputOptions: this._options.replaceInputOptions,
					onReplace: () => this._onDidRequestReplace.fire(),
					onReplaceAll: () => this._onDidRequestReplaceAll.fire(),
					onReplaceInputFocus: () => this._replaceInputFocused.set(true, undefined),
					onReplaceInputBlur: () => this._replaceInputFocused.set(false, undefined),
				};
			}

			// Create the find widget
			const findWidget = React.createElement(PositronFindWidget, {
				ref: this._widgetRef,
				contextKeyService: this._options.contextKeyService,
				contextViewService: this._options.contextViewService,
				findInputOptions: this._options.findInputOptions,
				findText: this.searchString,
				isVisible: this._isVisible,
				matchCase: this.matchCase,
				matchCount: this.matchCount,
				matchIndex: this.matchIndex,
				matchWholeWord: this.wholeWord,
				replace: replaceProps,
				useRegex: this.isRegex,
				onFindInputBlur: () => this._inputFocused.set(false, undefined),
				onFindInputFocus: () => this._inputFocused.set(true, undefined),
				onNextMatch: () => this._onDidRequestFindNext.fire(),
				onPreviousMatch: () => this._onDidRequestFindPrevious.fire(),
			});

			// Render the widget
			this._renderer.render(findWidget);
		}

		// Set input-focused synchronously so that the find widget's keybindings
		// take effect immediately. Without this, cells can consume keyboard
		// events (e.g. Enter to edit the active cell) before the context key
		// propagates through the async DOM focus path.
		transaction((tx) => {
			this._isVisible.set(true, tx);
			this._inputFocused.set(true, tx);

			if (options?.replace) {
				this.replaceIsVisible.set(true, tx);
			}
		});

		// Re-focus when the widget is already visible (e.g. Cmd+F while open).
		// When transitioning from hidden to visible, the widget's useEffect
		// handles focus after React re-renders and the container is displayed.
		this._widgetRef.current?.focusFindInput();
	}

	/**
	 * Hides the find widget.
	 */
	public hide(): void {
		this._isVisible.set(false, undefined);
		this.replaceIsVisible.set(false, undefined);
	}
}
