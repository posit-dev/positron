/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarButton';
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { ActionBarTooltip } from 'vs/platform/positronActionBar/browser/components/actionBarTooltip';

/**
 * ActionBarButtonProps interface.
 */
export interface ActionBarButtonProps {
	iconId?: string;
	text?: string;
	dropDown?: boolean;
	align?: 'left' | 'right';
	tooltip: string | (() => string | undefined) | undefined;
	enabled?: boolean;
	onClick?: React.MouseEventHandler;
}

/**
 * ActionBarButton component.
 * @param props An ActionBarButtonProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarButton = forwardRef<HTMLDivElement, ActionBarButtonProps>((props: ActionBarButtonProps, ref) => {
	// Create the class name.
	const className = props.enabled === undefined || props.enabled ? 'action-bar-button' : 'action-bar-button disabled';

	// Render.
	return (
		<ActionBarTooltip {...props}>
			<div ref={ref} className={className} onClick={props.onClick}>
				<div className='action-bar-button-face'>
					{props.iconId && <div className={`action-bar-button-icon codicon codicon-${props.iconId}`} />}
					{props.text && <div className='action-bar-button-text'>{props.text}</div>}
					{props.dropDown && <div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />}
				</div>
			</div>
		</ActionBarTooltip>
	);
});
