/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./tooltip';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';

/**
 * TooltipProps interface.
 */
interface TooltipProps {
	align?: 'left' | 'right';
	tooltip: string | (() => string | undefined) | undefined;
}

/**
 * Tooltip component.
 * @param props A TooltipProps that contains the component properties.
 * @returns The component.
 */
export const Tooltip = (props: PropsWithChildren<TooltipProps>) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();
	const [mouseInside, setMouseInside] = useState(false);
	const [tooltip, setTooltip] = useState<string | undefined>(undefined);
	const [showTooltip, setShowTooltip] = useState(false);

	// Tooltip.
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
		const showTooltipDelay = positronTopBarContext.showTooltipDelay();

		// If we should show the toolip immediately, do it.
		if (!showTooltipDelay) {
			setShowTooltip(true);
			return;
		}

		// Set up a timeout to show the tooltip.
		const timeout = setTimeout(() => {
			if (!positronTopBarContext.menuShowing) {
				setShowTooltip(true);
			}
		}, showTooltipDelay);
		return () => clearTimeout(timeout);
	}, [positronTopBarContext, mouseInside]);

	// Mouse enter handler.
	const mouseEnterHandler = () => {
		setMouseInside(true);
	};

	// Mouse leave handler.
	const mouseLeaveHandler = () => {
		setMouseInside(false);
		if (showTooltip) {
			// Hide the toolip and refresh the tooltip keep alive so that the next tooltip will be shown immediately.
			setShowTooltip(false);
			positronTopBarContext.refreshTooltipKeepAlive();
		}
	};

	// Click handler.
	const clickHandler = () => {
		// When the mouse is clicked, hide the tooltip but do not refresh the tooltip keep alive. A click resets the tooltip delay.
		setShowTooltip(false);
	};

	// Render.
	return (
		<div className='tool-tip-container'>
			<div className='tool-tip-wrapper' onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler} onClick={clickHandler}>
				{props.children}
			</div>
			{showTooltip &&
				<div className={`tool-tip tool-tip-${props.align ?? 'left'}`}>
					<div className='tool-tip-text'>{tooltip}</div>
				</div>}
		</div>
	);
};
