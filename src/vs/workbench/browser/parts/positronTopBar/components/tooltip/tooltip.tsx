/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/tooltip';
const React = require('react');
import { useEffect, useState } from 'react';
import { ITooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';
import { ILocalizedString } from 'vs/platform/action/common/action';

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

	useEffect(() => {
		console.log('useEffect called for control');
	}, [mouseInside]);

	// Handlers.
	const mouseEnterHandler = () => {
		setMouseInside(true);
	};

	const mouseLeaveHandler = () => {
		setMouseInside(false);
		setShowTooltip(false);
	};

	// Render.
	return (
		<div className='yack'>
			<div className='tooltip' onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
				{props.children}
			</div>
			{mouseInside && showTooltip && props.tooltip && <div className='toolie'>
				<div className='tyu'>{props.tooltip}</div>
			</div>}
		</div>
	);
};
