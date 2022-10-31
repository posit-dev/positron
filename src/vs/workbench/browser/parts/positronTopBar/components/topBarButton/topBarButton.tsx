/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarButton';
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { Tooltip } from 'vs/workbench/browser/parts/positronTopBar/components/tooltip/tooltip';

/**
 * TopBarButtonProps interface.
 */
export interface TopBarButtonProps {
	iconId: string;
	text?: string;
	dropDown?: boolean;
	align?: 'left' | 'right';
	tooltip: string | (() => string | undefined) | undefined;
	enabled?: boolean;
	onClick?: React.MouseEventHandler;
}

/**
 * TopBarButton component.
 * @param props A TopBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarButton = forwardRef<HTMLDivElement, TopBarButtonProps>((props: TopBarButtonProps, ref) => {
	// Create the class name.
	const className = props.enabled === undefined || props.enabled ? 'top-bar-button' : 'top-bar-button disabled';

	// Render.
	return (
		<Tooltip {...props}>
			<div ref={ref} className={className} onClick={props.onClick}>
				<div className='top-bar-button-face'>
					<div className={`top-bar-button-icon codicon codicon-${props.iconId}`}></div>
					{props.text ? <div className='top-bar-button-text'>{props.text}</div> : null}
					{props.dropDown && <div className='top-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />}
				</div>
			</div>
		</Tooltip>
	);
});
