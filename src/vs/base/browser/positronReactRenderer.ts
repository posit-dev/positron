/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
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
 * IReactComponentContainer interface.
 */
export interface IReactComponentContainer {
	readonly onSizeChanged: Event<ISize>;
	readonly onVisibilityChanged: Event<boolean>;
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
