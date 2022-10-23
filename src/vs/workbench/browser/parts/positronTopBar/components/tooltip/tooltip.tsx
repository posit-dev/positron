/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./tooltip';
const React = require('react');
import { PropsWithChildren, useEffect, useState } from 'react';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ITooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';

/**
 * TooltipProps interface.
 */
interface TooltipProps {
	tooltipManager?: ITooltipManager;
	tooltip?: string | ILocalizedString;
}

/**
 * Tooltip component.
 * @param props A TooltipProps that contains the component properties.
 * @returns The component.
 */
export const Tooltip = (props: PropsWithChildren<TooltipProps>) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext()!;
	const [mouseInside, setMouseInside] = useState(false);
	const [showTooltip, setShowTooltip] = useState(false);

	const toolTip = typeof props.tooltip === 'string' ? props.tooltip : props.tooltip?.value;

	// Tooltip.
	useEffect(() => {
		// If the mouse is not inside, or there isn't a tooltip to show, return.
		if (!mouseInside || !toolTip) {
			return;
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
		return () => {
			clearTimeout(timeout);
		};
	}, [mouseInside]);

	// Mouse enter handler.
	const mouseEnterHandler = () => {
		setMouseInside(true);
	};

	// Mouse leave handler.
	const mouseLeaveHandler = () => {
		setMouseInside(false);
		if (showTooltip) {
			setShowTooltip(false);
			positronTopBarContext.tooltipHidden();
		}
	};

	// Render.
	return (
		<div className='tool-tip-container'>
			<div className='tool-tip-wrapper' onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
				{props.children}
			</div>
			{showTooltip && <div className='tool-tip'>
				<div className='tool-tip-text'>{toolTip}</div>
			</div>}
		</div>
	);
};
