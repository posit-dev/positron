/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { MutableRefObject, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { usePositronActionBarContext } from './positronActionBarContext.js';

/**
 * The ref and handlers returned by useActionBarHover. Spread them onto the target element.
 */
export interface ActionBarHover<T extends HTMLElement> {
	readonly ref: MutableRefObject<T>;
	readonly onMouseEnter: () => void;
	readonly onMouseLeave: () => void;
	readonly onFocus: () => void;
	readonly onBlur: () => void;
}

/**
 * Shows an action bar hover (tooltip) for an element while the mouse is over it or it has
 * keyboard focus. While the hover is showing, it updates when the content changes.
 * @param content The hover text.
 * @returns The ref and handlers to spread onto the target element.
 */
export const useActionBarHover = <T extends HTMLElement = HTMLDivElement>(content: string): ActionBarHover<T> => {
	// Context hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const hoverManager = positronActionBarContext?.hoverManager;

	// Reference hooks.
	const ref = useRef<T>(undefined!);

	// State hooks.
	const [hoverActive, setHoverActive] = useState(false);

	// Show the hover, or update it when the content changes, while it is active.
	useEffect(() => {
		if (hoverActive && ref.current) {
			hoverManager?.showHover(ref.current, content);
		}
	}, [hoverActive, hoverManager, content]);

	const show = () => setHoverActive(true);
	const hide = () => {
		setHoverActive(false);
		hoverManager?.hideHover();
	};

	return {
		ref,
		onMouseEnter: show,
		onMouseLeave: hide,
		onFocus: show,
		onBlur: hide,
	};
};
