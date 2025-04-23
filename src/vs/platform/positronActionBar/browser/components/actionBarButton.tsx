/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarButton.css';

// React.
import React, { useRef, PropsWithChildren, useImperativeHandle, forwardRef } from 'react';

// Other dependencies.
import { Icon } from '../../../action/common/action.js';
import { asCSSUrl, CssFragment } from '../../../../base/browser/cssValue.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { Button, MouseTrigger } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { optionalBoolean, optionalValue, positronClassNames } from '../../../../base/common/positronUtilities.js';
import { ColorScheme } from '../../../theme/common/theme.js';

/**
 * ActionBarButtonIconProps type
 */
type ActionBarButtonIconProps = {
	readonly icon?: Icon;
	readonly iconFontSize?: number;
	readonly iconImageSrc?: never;
	readonly iconHeight?: never;
	readonly iconWidth?: never;
} | {
	readonly icon?: never;
	readonly iconFontSize?: never;
	readonly iconImageSrc?: string;
	readonly iconHeight?: number;
	readonly iconWidth?: number;
};

/**
 * ActionBarButtonCommonProps type
 */
type ActionBarButtonCommonProps = {
	readonly align?: 'left' | 'right';
	readonly ariaLabel?: string;
	readonly border?: boolean;
	readonly checked?: boolean;
	readonly dataTestId?: string;
	readonly disabled?: boolean;
	readonly dropdownAriaLabel?: string;
	readonly dropdownIndicator?: 'disabled' | 'enabled' | 'enabled-split';
	readonly dropdownTooltip?: string | (() => string | undefined);
	readonly fadeIn?: boolean;
	readonly label?: string;
	readonly maxTextWidth?: number;
	readonly mouseTrigger?: MouseTrigger;
	readonly tooltip?: string | (() => string | undefined);
	readonly onDropdownPressed?: () => void;
	readonly onMouseEnter?: () => void;
	readonly onMouseLeave?: () => void;
	readonly onPressed?: () => void;
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

	// Aria-hide the inner elements and promote the button text to an aria-label in order to
	// avoid VoiceOver treating buttons as groups. See VSCode issue for more:
	// https://github.com/microsoft/vscode/issues/181739#issuecomment-1779701917
	const ariaLabel = props.ariaLabel ? props.ariaLabel : props.label;

	// Figure out how to display the icon.
	let iconClassNames: string[] = [];
	const iconStyle: React.CSSProperties = {};
	if (props.icon) {
		// If it's a theme icon, use the theme icon class names.
		if (ThemeIcon.isThemeIcon(props.icon)) {
			iconClassNames = ThemeIcon.asClassNameArray(props.icon);
		} else {
			// Determine the css background image based on the color theme and icon.
			let cssBackgroundImage: CssFragment | undefined;
			if (context.themeService.getColorTheme().type === ColorScheme.LIGHT && props.icon.light) {
				cssBackgroundImage = asCSSUrl(props.icon.light);
			} if (context.themeService.getColorTheme().type === ColorScheme.DARK && props.icon.dark) {
				asCSSUrl(props.icon.dark);
			} else {
				cssBackgroundImage = asCSSUrl(props.icon.dark ?? props.icon.light);
			}

			// Set the icon style, if the css background image is defined.
			if (cssBackgroundImage) {
				iconStyle.width = '16px';
				iconStyle.height = '16px';
				iconStyle.backgroundSize = '16px';
				iconStyle.backgroundPosition = '50%';
				iconStyle.backgroundRepeat = 'no-repeat';
				iconStyle.backgroundImage = cssBackgroundImage;
			}
		}
	}

	/**
	 * ActionBarButtonFace component.
	 * @returns The rendered component.
	 */
	const ActionBarButtonFace = () => {
		return (
			<div aria-hidden='true' className='action-bar-button-face' data-testid={props.dataTestId}>
				{props.icon &&
					<div
						className={positronClassNames(
							'action-bar-button-icon',
							props.dropdownIndicator,
							...iconClassNames
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
				{props.label &&
					<div
						className='action-bar-button-label'
						style={{
							marginLeft: (props.icon || props.iconImageSrc) ? 0 : 4,
							maxWidth: optionalValue(props.maxTextWidth, 'none')
						}}
					>
						{props.label}
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
