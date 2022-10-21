/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./css/topBarButton';
const React = require('react');
import { forwardRef } from 'react';
import { Tooltip } from 'vs/workbench/browser/parts/positronTopBar/components/tooltip/tooltip';
import { ILocalizedString } from 'vs/platform/action/common/action';

/**
 * TopBarButtonProps interface.
 */
interface TopBarButtonProps {
	iconClassName: string;
	dropDown?: boolean;
	tooltip?: string | ILocalizedString;
	execute?: VoidFunction;
}

/**
 * TopBarButton component.
 * @param props A TopBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarButton = forwardRef<HTMLDivElement, TopBarButtonProps>((props: TopBarButtonProps, ref) => {

	const mouseEnterHandler = () => {
		console.log('Mouse is inside button!');
	};

	const mouseLeaveHandler = () => {
		console.log('Mouse is outside button!');
	};

	// Render.
	return (
		<Tooltip {...props}>
			<div ref={ref} className='top-bar-button' onClick={props.execute} onMouseEnter={mouseEnterHandler} onMouseLeave={mouseLeaveHandler}>
				<div className='top-bar-button-face'>
					<div className={`top-bar-button-icon ${props.iconClassName}`} />
					{props.dropDown && <div className='top-bar-button-drop-down-arrow' />}
				</div>
			</div>
		</Tooltip>
	);
});
