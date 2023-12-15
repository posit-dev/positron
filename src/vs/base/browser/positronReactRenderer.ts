/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createRoot, Root } from 'react-dom/client';
import { Disposable } from 'vs/base/common/lifecycle';

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
	private root?: Root;

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
		this.root = createRoot(container);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Unmount and dispose of the root.
		if (this.root) {
			this.root.unmount();
			this.root = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Renders the React component that was supplied.
	 * @param reactElement The ReactElement to render.
	 */
	public render(reactElement: React.ReactElement) {
		if (this.root) {
			this.root.render(reactElement);
		}
	}

	/**
	 * Destroys the ReactRenderer.
	 * @deprecated Use Disposable instead.
	 */
	public destroy() {
		if (this.root) {
			this.root.unmount();
			this.root = undefined;
		}
	}

	//#endregion Public Methods
}
