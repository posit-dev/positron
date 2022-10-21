/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/tooltip';
const React = require('react');
import { useEffect, useState } from 'react';
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
export const Tooltip = (props: TooltipProps & { children: React.ReactNode }) => {
	// Hooks.
	const [mouseInside, setMouseInside] = useState(false);
	const [showTooltip, setShowTooltip] = useState(false);
	const positronTopBarContext = usePositronTopBarContext();

	useEffect(() => {
		console.log('useEffect called for control');
	}, [mouseInside]);

	// Handlers.
	const mouseEnterHandler = () => {
		console.log(`Last tooltip shown at ${positronTopBarContext?.lastTooltipShownAt}`);
		positronTopBarContext?.setLastTooltipShownAt(new Date().getTime());
		setMouseInside(true); // Temporary.
		setShowTooltip(true); // Temporary.
	};

	const mouseLeaveHandler = () => {
		setMouseInside(false);
		setShowTooltip(false);
	};

	// Render.
	return (
		<div className='tool-tip-container'>
			<div className='tool-tip-wrapper' onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
				{props.children}
			</div>
			{mouseInside && showTooltip && props.tooltip && <div className='tool-tip'>
				<div className='tool-tip-text'>Tooltip text</div>
			</div>}
		</div>
	);
};
