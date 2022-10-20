/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarButton';
const React = require('react');
import { ITooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';
import { Tooltip } from 'vs/workbench/browser/parts/positronTopBar/components/tooltip/tooltip';

/**
 * TopBarButtonProps interface.
 */
interface TopBarButtonProps {
	tooltipManager?: ITooltipManager;
	iconClassName: string;
	dropDown?: boolean;
	tooltip?: string;
}

/**
 * TopBarButton component.
 * @param props A TopBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarButton = (props: TopBarButtonProps) => {
	// Handlers.
	const clickHandler = () => {
		console.log('Button was clicked');
	};

	const mouseEnterHandler = () => {
		console.log('Mouse is inside button!');
	};

	const mouseLeaveHandler = () => {
		console.log('Mouse is outside button!');
	};

	// Render.
	return (
		<Tooltip {...props}>
			<div className='top-bar-button' onClick={clickHandler} onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
				<div className='top-bar-button-face'>
					<div className={`top-bar-button-icon ${props.iconClassName}`} />
					{props.dropDown && <div className='top-bar-button-drop-down-arrow' />}
				</div>
			</div>
		</Tooltip>
	);
};
