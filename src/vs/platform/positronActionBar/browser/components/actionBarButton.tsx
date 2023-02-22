/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarButton';
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { ActionBarTooltip } from 'vs/platform/positronActionBar/browser/components/actionBarTooltip';
import { optionalBoolean, optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * ActionBarButtonProps interface.
 */
export interface ActionBarButtonProps {
	iconId?: string;
	text?: string;
	maxTextWidth?: number;
	dropDown?: boolean;
	align?: 'left' | 'right';
	layout?: 'loose' | 'tight';
	tooltip?: string | (() => string | undefined);
	disabled?: boolean;
	onClick?: React.MouseEventHandler;
}

/**
 * ActionBarButton component.
 * @param props An ActionBarButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarButton = forwardRef<HTMLButtonElement, ActionBarButtonProps>((props: ActionBarButtonProps, ref) => {
	// Create the class names.
	const classNames = positronClassNames(
		'action-bar-button',
		{ 'disabled': optionalBoolean(props.disabled) }
	);

	// Render.
	return (
		<ActionBarTooltip {...props}>
			<button ref={ref} className={classNames} onClick={props.onClick}>
				<div className='action-bar-button-face' style={{ padding: props.layout === 'tight' ? '0' : '0 2px' }}>
					{props.iconId && <div className={`action-bar-button-icon codicon codicon-${props.iconId}`} />}
					{props.text && <div className='action-bar-button-text' style={{ maxWidth: optionalValue(props.maxTextWidth, 'none') }}>{props.text}</div>}
					{props.dropDown && <div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />}
				</div>
			</button>
		</ActionBarTooltip>
	);
});
