/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./tooltip';
const React = require('react');
import { PropsWithChildren, useEffect, useState } from 'react';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';

/**
 * TooltipAlignment type.
 */
export type TooltipAlignment = 'left' | 'right';

/**
 * TooltipProps interface.
 */
interface TooltipProps {
	tooltipAlignment: TooltipAlignment;
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
		if (!positronTopBarContext || !mouseInside || !props.tooltip) {
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
			setShowTooltip(true);
		}, showTooltipDelay);
		return () => clearTimeout(timeout);
	}, [mouseInside]);

	// Mouse enter handler.
	const mouseEnterHandler = () => {
		setMouseInside(true);
	};

	// Mouse leave handler.
	const mouseLeaveHandler = () => {
		setMouseInside(false);
		clearTooltip();
	};

	// Mouse down handler.
	const mouseDownHandler = () => {
		clearTooltip();
	};

	// Clear tooltip.
	const clearTooltip = () => {
		setShowTooltip(false);
		positronTopBarContext?.tooltipHidden();
	};

	// Set the tooltip class name.
	const tooltipClassName = props.tooltipAlignment === 'left' ? 'tool-tip tool-tip-left' : 'tool-tip tool-tip-right';

	// Render.
	return (
		<div className='tool-tip-container'>
			<div className='tool-tip-wrapper' onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler} onMouseDown={mouseDownHandler}>
				{props.children}
			</div>
			{showTooltip &&
				<div className={tooltipClassName}>
					<div className='tool-tip-text'>{tooltip}</div>
				</div>}
		</div>
	);
};
