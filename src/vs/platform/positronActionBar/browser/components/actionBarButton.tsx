/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBarButton';

// React.
import * as React from 'react';
import { forwardRef, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { optionalBoolean, optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

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
 * @param ref A ref to the HTMLButtonElement.
 * @returns The rendered component.
 */
export const ActionBarButton = forwardRef<
	HTMLButtonElement,
	PropsWithChildren<ActionBarButtonProps>
>((props, ref) => {
	// Context hooks.
	const context = usePositronActionBarContext();

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
		<Button
			ref={ref}
			hoverManager={context.hoverManager}
			className={positronClassNames(
				'action-bar-button',
				{ 'border': optionalBoolean(props.border) },
				{ 'fade-in': optionalBoolean(props.fadeIn) }
			)}
			onPressed={props.onPressed}
			ariaLabel={ariaLabel}
			tooltip={props.tooltip}
			disabled={props.disabled}
		>
			<div
				className='action-bar-button-face'
				style={{ padding: props.layout === 'tight' ? '0' : '0 2px' }}
				aria-hidden='true'
			>
				{props.iconId && (
					<div
						className={`action-bar-button-icon codicon codicon-${props.iconId}`}
						style={iconStyle}
					/>
				)}
				{props.text && (
					<div
						className='action-bar-button-text'
						style={{
							marginLeft: props.iconId ? 0 : 4,
							maxWidth: optionalValue(props.maxTextWidth, 'none')
						}}
					>
						{props.text}
					</div>
				)}
				{props.dropDown && (
					<div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
				)}
				{props.children}
			</div>
		</Button>
	);
});

// Set the display name.
ActionBarButton.displayName = 'ActionBarButton';
