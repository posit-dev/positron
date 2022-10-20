/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/tooltip';
const React = require('react');
import { useState } from 'react';
import { ITooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';

/**
 * TooltipProps interface.
 */
interface TooltipProps {
	tooltipManager?: ITooltipManager;
	tooltip?: string;
}

/**
 * Tooltip component.
 * @param props A TooltipProps that contains the component properties.
 * @returns The component.
 */
export const Tooltip = (props: TooltipProps & { children: React.ReactNode }) => {
	// Hooks.
	const [hover, setHover] = useState(false);

	const mouseEnterHandler = () => {
		console.log('Mouse is inside tooltip');
		setHover(true);
	};

	const mouseLeaveHandler = () => {
		console.log('Mouse is outside tooltip');
		setHover(false);
	};

	const mouseOverHandler = () => {
		console.log('Mouse is over');
		setHover(false);
	};

	// Render.
	return (
		<div className='tooltip' onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler} onMouseOver={mouseOverHandler}>
			{props.children}
			{hover && <div className='toolie'>Tip</div>}
		</div>
	);
};
