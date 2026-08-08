/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useLayoutEffect, useRef } from 'react';

/**
 * DomSlotProps interface.
 */
export interface DomSlotProps {
	/**
	 * Class name for the wrapper, when the page needs to position the slot.
	 * Leave unset when the page's own layout already handles it.
	 */
	readonly className?: string;

	/**
	 * The element to place. Built outside React, usually by the editor pane.
	 */
	readonly element: HTMLElement;
}

/**
 * DomSlot component. Places an element that React does not own into the React
 * tree. Renders no children, so React never tries to reconcile that element.
 * @param props A DomSlotProps that contains the component properties.
 * @returns The rendered component.
 */
export const DomSlot = (props: DomSlotProps) => {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const element = props.element;
		ref.current?.appendChild(element);
		return () => element.remove();
	}, [props.element]);

	return <div ref={ref} className={props.className} />;
};
