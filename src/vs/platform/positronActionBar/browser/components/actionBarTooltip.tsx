/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarTooltip';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * ActionBarTooltipProps interface.
 */
interface ActionBarTooltipProps {
	align?: 'left' | 'right';
	tooltip?: string | (() => string | undefined);
}

/**
 * ActionBarTooltip component.
 * @param props An ActionBarTooltipProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarTooltip = (props: PropsWithChildren<ActionBarTooltipProps>) => {
	// Context hooks.
	const positronActionBarContext = usePositronActionBarContext();

	// State hooks.
	const [mouseInside, setMouseInside] = useState(false);
	const [tooltip, setTooltip] = useState<string | undefined>(undefined);
	const [showTooltip, setShowTooltip] = useState(false);

	// Tooltip effect.
	useEffect(() => {
		// If we cannot show the tooltip, do nothing.
		if (!mouseInside || !props.tooltip) {
			return;
		}

		// Set the tooltip.
		if (typeof props.tooltip === 'string') {
			setTooltip(props.tooltip);
		} else {
			// Get the dynamic tooltip. If it's undefined, we cannot show the tooltip. Do nothing.
			const dynamicTooltip = props.tooltip();
			if (!dynamicTooltip) {
				return;
			}

			// Set the dynamic tooltip.
			setTooltip(dynamicTooltip);
		}

		// Get the show tooltip delay.
		const showTooltipDelay = positronActionBarContext.showTooltipDelay();

		// If we should show the toolip immediately, do it.
		if (!showTooltipDelay) {
			setShowTooltip(true);
			return;
		}

		// Set up a timeout to show the tooltip.
		const timeout = setTimeout(() => {
			if (!positronActionBarContext.menuShowing) {
				setShowTooltip(true);
			}
		}, showTooltipDelay);

		// Return the cleanup funciton.
		return () => clearTimeout(timeout);
	}, [mouseInside]);

	// Render.
	return (
		<div className='action-bar-tool-tip-container'>
			<div
				className='action-bar-tool-tip-wrapper'
				onMouseEnter={() => setMouseInside(true)}
				onMouseLeave={() => {
					setMouseInside(false);
					if (showTooltip) {
						setShowTooltip(false);
						positronActionBarContext.updateTooltipLastHiddenAt();
					}
				}}
				onMouseDown={() => {
					setShowTooltip(false);
					positronActionBarContext.resetTooltipLastHiddenAt();
				}}
			>
				{props.children}
			</div>
			{showTooltip &&
				<div className={`action-bar-tool-tip action-bar-tool-tip-${props.align ?? 'left'}`}>
					<div className='action-bar-tool-tip-text'>{tooltip}</div>
				</div>}
		</div>
	);
};
