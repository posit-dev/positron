/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarButton';
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ActionBarTooltip } from 'vs/platform/positronActionBar/browser/components/actionBarTooltip';
import { optionalBoolean, optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * ActionBarButtonProps interface.
 */
export interface ActionBarButtonProps {
	fadeIn?: boolean;
	iconId?: string;
	iconFontSize?: number;
	text?: string;
	maxTextWidth?: number;
	border?: boolean;
	dropDown?: boolean;
	align?: 'left' | 'right';
	layout?: 'loose' | 'tight';
	tooltip?: string | (() => string | undefined);
	disabled?: boolean;
	onClick?: () => void;
}

/**
 * ActionBarButton component.
 * @param props An ActionBarButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarButton = forwardRef<HTMLDivElement, ActionBarButtonProps>((props, ref) => {
	// Create the class names.
	const buttonClassNames = positronClassNames(
		'action-bar-button',
		{ 'border': optionalBoolean(props.border) },
		{ 'fade-in': optionalBoolean(props.fadeIn) },
		{ 'disabled': optionalBoolean(props.disabled) }
	);

	// Create the icon style.
	let iconStyle: React.CSSProperties = {};
	if (props.iconId && props.iconFontSize) {
		iconStyle = { ...iconStyle, fontSize: props.iconFontSize };
	}

	// Render.
	return (
		<ActionBarTooltip {...props}>
			<PositronButton ref={ref} className={buttonClassNames} onClick={props.onClick}>
				<div className='action-bar-button-face' style={{ padding: props.layout === 'tight' ? '0' : '0 2px' }}>
					{props.iconId && <div className={`action-bar-button-icon codicon codicon-${props.iconId}`} style={iconStyle} />}
					{props.text && <div className='action-bar-button-text' style={{ maxWidth: optionalValue(props.maxTextWidth, 'none') }}>{props.text}</div>}
					{props.dropDown && <div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />}
				</div>
			</PositronButton>
		</ActionBarTooltip>
	);
});
