/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { ReactElement } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Other dependencies.
import { Event } from '../common/event.js';
import { Disposable, IDisposable } from '../common/lifecycle.js';
import { PositronReactServices } from './positronReactServices.js';
import { PositronReactServicesContext } from './positronReactRendererContext.js';

/**
 * ISize interface.
 */
export interface ISize {
	width: number;
	height: number;
}

/**
 * IElementPosition interface.
 */
export interface IElementPosition {
	x: number;
	y: number;
}

/**
 * IReactComponentContainer interface.
 */
export interface IReactComponentContainer {
	/**
	 * Gets the width.
	 */
	readonly width: number;

	/**
	 * Gets the height.
	 */
	readonly height: number;

	/**
	 * Gets the container visibility.
	 */
	readonly containerVisible: boolean;

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus(): void;

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged?(focused: boolean): void;

	/**
	 * Notifies the React component container when visibility changes.
	 */
	visibilityChanged?(visible: boolean): void;

	/**
	 * onFocused event.
	 */
	readonly onFocused: Event<void>;

	/**
	 * onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize>;

	/**
	 * onPositionChanged event (optional).
	 */
	readonly onPositionChanged?: Event<IElementPosition>;

	/**
	 * onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean>;

	/**
	 * onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void>;

	/**
	 * onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void>;
}

/**
 * PositronReactRenderer class.
 * Manages rendering a React component in the specified container HTMLElement.
 */
export class PositronReactRenderer extends Disposable {
	//#region Private Properties

	/**
	 * The root where the React element will be rendered.
	 */
	private _root?: Root;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Initializes a new instance of the ReactRenderer class.
	 * @param container The container HTMLElement where the React component will be rendered.
	 */
	constructor(container: HTMLElement) {
		// Call the base class's constructor.
		super();

		// Create the root.
		this._root = createRoot(container);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Unmount and dispose of the root.
		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Renders the React element that was supplied.
	 * @param reactElement The React element.
	 */
	public render(reactElement: ReactElement) {
		if (this._root) {
			this._root.render(
				<PositronReactServicesContext.Provider value={PositronReactServices.services}>
					{reactElement}
				</PositronReactServicesContext.Provider>
			);
		}
	}

	/**
	 * Registers an IDisposable with the same lifecycle as the PositronReactRenderer.
	 * @param disposable The IDisposable.
	 */
	public register(disposable: IDisposable) {
		this._register(disposable);
	}

	/**
	 * Destroys the ReactRenderer.
	 * @deprecated Use Disposable instead.
	 */
	public destroy() {
		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}
	}

	//#endregion Public Methods
}
