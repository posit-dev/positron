/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createRoot, Root } from 'react-dom/client';
import { IDisposable } from 'vs/base/common/lifecycle';

/**
 * ReactComponentRenderer class.
 */
export class ReactComponentRenderer implements IDisposable {
	/**
	 * The Root where the React component is rendered.
	 */
	private root: Root | undefined;

	/**
	 * Initializes a new instance of the ReactComponentRenderer class.
	 * @param container The container into which the React component is rendered.
	 * @param children The React component to render.
	 */
	constructor(container: HTMLElement, children: React.ReactNode) {
		this.root = createRoot(container);
		this.root.render(children);
	}

	/**
	 * Dispose. Unmounts the React component.
	 */
	dispose() {
		if (this.root) {
			this.root.unmount();
			this.root = undefined;
		}
	}
}
