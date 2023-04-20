/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createRoot, Root } from 'react-dom/client';

/**
 * ISize interface.
 */
export interface ISize {
	width: number;
	height: number;
}

/**
 * IFocusReceiver interface.
 */
export interface IFocusReceiver {
	/**
	 * onFocused event.
	 */
	readonly onFocused: Event<void>;
}

/**
 * IReactComponentContainer interface.
 */
export interface IReactComponentContainer extends IFocusReceiver {
	/**
	 * Gets the width.
	 */
	readonly width: number;

	/**
	 * Gets the height.
	 */
	readonly height: number;

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus(): void;

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged?(focused: boolean): void;

	/**
	 * onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize>;
}

/**
 * PositronReactRenderer class.
 * Manages rendering a React component in the specified container HTMLElement.
 */
export class PositronReactRenderer {
	/**
	 * The root where the React element will be rendered.
	 */
	private _root?: Root;

	/**
	 * Initializes a new instance of the ReactRenderer class.
	 * @param container The container HTMLElement where the React component will be rendered.
	 */
	constructor(container: HTMLElement) {
		this._root = createRoot(container);
	}

	/**
	 * Renders the React component that was supplied.
	 * @param reactElement The ReactElement to render.
	 */
	public render(reactElement: React.ReactElement) {
		if (this._root) {
			this._root.render(reactElement);
		}
	}

	/**
	 * Destroys the ReactRenderer.
	 */
	public destroy() {
		if (this._root) {
			this._root.unmount();
			this._root = undefined;
		}
	}
}
