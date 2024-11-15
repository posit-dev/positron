/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBarButton';

// React.
import * as React from 'react';
import { forwardRef, PropsWithChildren, useImperativeHandle, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { optionalBoolean, optionalValue, positronClassNames } from 'vs/base/common/positronUtilities';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * ActionBarButtonProps interface.
 */
export interface ActionBarButtonProps {
	readonly fadeIn?: boolean;
	readonly iconId?: string;
	readonly iconFontSize?: number;
	readonly text?: string;
	readonly maxTextWidth?: number;
	readonly border?: boolean;
	readonly align?: 'left' | 'right';
	readonly tooltip?: string | (() => string | undefined);
	readonly disabled?: boolean;
	readonly ariaLabel?: string;
	readonly dropdownIndicator?: 'disabled' | 'enabled' | 'enabled-split';
	readonly onMouseEnter?: () => void;
	readonly onMouseLeave?: () => void;
	readonly onPressed?: () => void;
	readonly onDropdownPressed?: () => void;
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

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);
	const dropdownButtonRef = useRef<HTMLButtonElement>(undefined!);

	// Imperative handle to ref.
	useImperativeHandle(ref, () => props.dropdownIndicator === 'enabled-split' ?
		dropdownButtonRef.current : buttonRef.current
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
		<Button
			ref={buttonRef}
			hoverService={context.hoverService}
			hoverManager={context.hoverManager}
			className={positronClassNames(
				'action-bar-button',
				{ 'border': optionalBoolean(props.border) },
				{ 'fade-in': optionalBoolean(props.fadeIn) }
			)}
			ariaLabel={ariaLabel}
			tooltip={props.tooltip}
			disabled={props.disabled}
			onMouseEnter={props.onMouseEnter}
			onMouseLeave={props.onMouseLeave}
			onPressed={props.onPressed}
		>
			<div className='action-bar-button-face' aria-hidden='true'>
				{props.iconId && (
					<div
						className={positronClassNames(
							'action-bar-button-icon',
							props.dropdownIndicator,
							'codicon',
							`codicon-${props.iconId}`
						)}
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
				{props.dropdownIndicator === 'enabled' && (
					<div className='action-bar-button-drop-down-container'>
						<div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
					</div>
				)}
				{props.dropdownIndicator === 'enabled-split' && (
					<Button
						ref={dropdownButtonRef}
						className='action-bar-button-drop-down-button'
						hoverService={context.hoverService}
						hoverManager={context.hoverManager}
						ariaLabel={ariaLabel}
						tooltip={props.tooltip}
						onPressed={props.onDropdownPressed}
					>
						<div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
					</Button>
				)}
				{props.children}
			</div>
		</Button>
	);
});

// Set the display name.
ActionBarButton.displayName = 'ActionBarButton';
