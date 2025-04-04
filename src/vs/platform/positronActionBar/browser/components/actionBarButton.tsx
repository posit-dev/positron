/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarButton.css';

// React.
import React, { useRef, PropsWithChildren, useImperativeHandle, forwardRef } from 'react';

// Other dependencies.
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { Button, MouseTrigger } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { optionalBoolean, optionalValue, positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * ActionBarButtonIconProps type
 */
type ActionBarButtonIconProps = {
	readonly iconId?: string;
	readonly iconFontSize?: number;
	readonly iconImageSrc?: never;
	readonly iconHeight?: never;
	readonly iconWidth?: never;
} | {
	readonly iconId?: never;
	readonly iconFontSize?: never;
	readonly iconImageSrc?: string;
	readonly iconHeight?: number;
	readonly iconWidth?: number;

};

/**
 * ActionBarButtonCommonProps type
 */
type ActionBarButtonCommonProps = {
	readonly fadeIn?: boolean;
	readonly text?: string;
	readonly maxTextWidth?: number;
	readonly align?: 'left' | 'right';
	readonly tooltip?: string | (() => string | undefined);
	readonly dataTestId?: string;
	readonly dropdownTooltip?: string | (() => string | undefined);
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly ariaLabel?: string;
	readonly dropdownAriaLabel?: string;
	readonly dropdownIndicator?: 'disabled' | 'enabled' | 'enabled-split';
	readonly border?: boolean;
	readonly mouseTrigger?: MouseTrigger;
	readonly onMouseEnter?: () => void;
	readonly onMouseLeave?: () => void;
	readonly onPressed?: () => void;
	readonly onDropdownPressed?: () => void;
}

/**
 * ActionBarButtonProps type.
 */
export type ActionBarButtonProps =
	ActionBarButtonCommonProps &
	ActionBarButtonIconProps

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

	/**
	 * ActionBarButtonFace component.
	 * @returns The rendered component.
	 */
	const ActionBarButtonFace = () => {
		return (
			<div aria-hidden='true' className='action-bar-button-face' data-testid={props.dataTestId}>
				{props.iconId &&
					<div
						className={positronClassNames(
							'action-bar-button-icon',
							props.dropdownIndicator,
							'codicon',
							`codicon-${props.iconId}`
						)}
						style={iconStyle}
					/>
				}
				{props.iconImageSrc &&
					<div
						className={positronClassNames(
							'action-bar-button-icon',
						)}
						style={iconStyle}>
						<img
							src={props.iconImageSrc}
							style={{
								height: props.iconHeight ?? 16,
								width: props.iconWidth ?? 16
							}}
						/>
					</div>
				}
				{props.text &&
					<div
						className='action-bar-button-text'
						style={{
							marginLeft: (props.iconId || props.iconImageSrc) ? 0 : 4,
							maxWidth: optionalValue(props.maxTextWidth, 'none')
						}}
					>
						{props.text}
					</div>
				}
				{props.dropdownIndicator === 'enabled' &&
					<div className='action-bar-button-drop-down-container'>
						<div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
					</div>
				}
			</div >
		);
	};

	// Render.
	if (props.dropdownIndicator !== 'enabled-split') {
		return (
			<Button
				ref={buttonRef}
				ariaLabel={ariaLabel}
				className={positronClassNames(
					'action-bar-button',
					{ 'fade-in': optionalBoolean(props.fadeIn) },
					{ 'checked': optionalBoolean(props.checked) },
					{ 'border': optionalBoolean(props.border) }
				)}
				disabled={props.disabled}
				hoverManager={context.hoverManager}
				mouseTrigger={props.mouseTrigger}
				tooltip={props.tooltip}
				onMouseEnter={props.onMouseEnter}
				onMouseLeave={props.onMouseLeave}
				onPressed={props.onPressed}
			>
				<ActionBarButtonFace />
				{props.children}
			</Button>
		);
	} else {
		return (
			<div className={positronClassNames(
				'action-bar-button',
				{ 'fade-in': optionalBoolean(props.fadeIn) },
				{ 'checked': optionalBoolean(props.checked) },
				{ 'border': optionalBoolean(props.border) }
			)}>
				<Button
					ref={buttonRef}
					ariaLabel={ariaLabel}
					className='action-bar-button-action-button'
					disabled={props.disabled}
					hoverManager={context.hoverManager}
					mouseTrigger={props.mouseTrigger}
					tooltip={props.tooltip}
					onMouseEnter={props.onMouseEnter}
					onMouseLeave={props.onMouseLeave}
					onPressed={props.onPressed}
				>
					<ActionBarButtonFace />
				</Button>
				<Button
					ref={dropdownButtonRef}
					ariaLabel={props.dropdownAriaLabel}
					className='action-bar-button-drop-down-button'
					hoverManager={context.hoverManager}
					mouseTrigger={MouseTrigger.MouseDown}
					tooltip={props.dropdownTooltip}
					onPressed={props.onDropdownPressed}
				>
					<div className='action-bar-button-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
				</Button>
				{props.children}
			</div>
		);
	}
});

// Set the display name.
ActionBarButton.displayName = 'ActionBarButton';
