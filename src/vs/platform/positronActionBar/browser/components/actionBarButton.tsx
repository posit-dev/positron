/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBarButton';

// React.
import * as React from 'react';
import { forwardRef, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
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
	ariaLabel?: string;
	onPressed?: () => void;
}

/**
 * ActionBarButton component.
 * @param props A PropsWithChildren<ActionBarButtonProps> that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarButton = forwardRef<HTMLButtonElement, PropsWithChildren<ActionBarButtonProps>>((props, ref) => {
	// Create the class names.
	const buttonClassNames = positronClassNames(
		'action-bar-button',
		{ 'border': optionalBoolean(props.border) },
		{ 'fade-in': optionalBoolean(props.fadeIn) }
	);

	// Create the icon style.
	let iconStyle: React.CSSProperties = {};
	if (props.iconId && props.iconFontSize) {
		iconStyle = { ...iconStyle, fontSize: props.iconFontSize };
	}

	// Aria-hide the inner elements and promote the button text to an aria-label in order to
	// avoid VoiceOver treating buttons as groups. See VSCode issue for more:
	// https://github.com/microsoft/vscode/issues/181739#issuecomment-1779701917
	const ariaLabel = props.ariaLabel ? props.ariaLabel : props.text;

	// Render.
	return (
		<ActionBarTooltip {...props}>
			<Button ref={ref} className={buttonClassNames} onPressed={props.onPressed} ariaLabel={ariaLabel} disabled={props.disabled}>
				<div className='action-bar-button-face' style={{ padding: props.layout === 'tight' ? '0' : '0 2px' }} aria-hidden='true' >
					{props.iconId && <div className={`action-bar-button-icon codicon codicon-${props.iconId}`} style={iconStyle} />}
					{props.text && <div className='action-bar-button-text' style={{ marginLeft: props.iconId ? 0 : 4, maxWidth: optionalValue(props.maxTextWidth, 'none') }}>{props.text}</div>}
					{props.dropDown && <div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />}
					{props.children}
				</div>
			</Button>
		</ActionBarTooltip>
	);
});
