/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarButton';
const React = require('react');
import { forwardRef } from 'react';
import { Tooltip } from 'vs/workbench/browser/parts/positronTopBar/components/tooltip/tooltip';
import { ILocalizedString } from 'vs/platform/action/common/action';

/**
 * TopBarButtonProps interface.
 */
interface TopBarButtonProps {
	iconId: string;
	text?: string;
	dropDown?: boolean;
	tooltip?: string | ILocalizedString;
	onClick?: React.MouseEventHandler;
}

/**
 * TopBarButton component.
 * @param props A TopBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarButton = forwardRef<HTMLDivElement, TopBarButtonProps>((props: TopBarButtonProps, ref) => {
	// Render.
	return (
		<Tooltip {...props}>
			<div ref={ref} className='top-bar-button' onClick={props.onClick}>
				<div className='top-bar-button-face'>
					<div className={`top-bar-button-icon codicon codicon-top-bar-button codicon-${props.iconId}`}></div>
					{props.text ? <div className='top-bar-button-text'>{props.text}</div> : null}
					{props.dropDown && <div className='codicon codicon-top-bar-button-drop-down-arrow codicon-positron-drop-down-arrow' />}
				</div>
			</div>
		</Tooltip>
	);
});
