/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarToggle.css';

// React.
import React from 'react';

// Other dependencies.
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { SegmentedToggle } from '../../../../base/browser/ui/positronComponents/segmentedToggle/segmentedToggle.js';

/**
 * ActionBarToggleProps interface.
 */
interface ActionBarToggleProps {
	readonly ariaLabel?: string;
	readonly leftTitle: string;
	readonly rightTitle: string;
	/**
	 * Whether the right option is the selected one. This is the inverse of SegmentedToggle's
	 * `leftActive`.
	 */
	readonly toggled?: boolean;
	/**
	 * Marks the toggle unavailable while leaving it focusable and in the tab order.
	 */
	readonly disabled?: boolean;
	readonly tooltip?: string | (() => string | undefined);
	readonly onChanged: (toggled: boolean) => void;
	ref?: React.Ref<HTMLButtonElement>;
}

/**
 * ActionBarToggle component. Adapts SegmentedToggle to the action bar: it supplies the bar's
 * hover manager and its own spacing. All of the DOM, ARIA and keyboard behavior lives in
 * SegmentedToggle, so a fix there reaches every caller.
 *
 * @param props An ActionBarToggleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarToggle = (props: ActionBarToggleProps) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	// Render.
	return (
		<SegmentedToggle
			ref={props.ref}
			ariaLabel={props.ariaLabel ?? props.leftTitle}
			className='action-bar-toggle'
			disabled={props.disabled}
			hoverManager={context.hoverManager}
			leftActive={!props.toggled}
			leftLabel={props.leftTitle}
			rightLabel={props.rightTitle}
			tooltip={props.tooltip}
			onToggle={() => props.onChanged(!props.toggled)}
		/>
	);
};
