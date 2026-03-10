/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { URI } from '../../../../base/common/uri.js';
import { Icon as IconType } from '../../../action/common/action.js';
import { ColorScheme } from '../../../theme/common/theme.js';
import { asCSSUrl } from '../../../../base/browser/cssValue.js';
import { ThemeIcon as ThemeIconClass } from '../../../../base/common/themables.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { asCssVariable } from '../../../theme/common/colorUtils.js';
import { editorErrorForeground } from '../../../theme/common/colorRegistry.js';

/**
 * IconProps interface.
 */
interface IconProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly icon: IconType;
}

/**
 * ThemeIconProps interface.
 */
interface ThemeIconProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly icon: ThemeIconClass;
}

/**
 * URIIconProps interface.
 */
interface URIIconProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly icon: { dark?: URI; light?: URI };
}

/**
 * ThemeIcon component - renders a codicon-based theme icon.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ThemeIcon = React.forwardRef<HTMLDivElement, ThemeIconProps>(
	({ icon, className, ...rest }, ref) => {
		const iconClassNames = ThemeIconClass.asClassNameArray(icon);

		return (
			<div
				ref={ref}
				className={positronClassNames(className, ...iconClassNames)}
				{...rest}
			/>
		);
	}
);

/**
 * URIIcon component - renders a URI-based icon with theme-aware dark/light variants.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const URIIcon = React.forwardRef<HTMLDivElement, URIIconProps>(
	({ icon: iconProp, className, style, ...rest }, ref) => {
		// Context hooks.
		const services = usePositronReactServicesContext();

		// Get the color theme type.
		const colorThemeType = services.themeService.getColorTheme().type;

		// Determine the CSS background image based on the color theme type and icon.
		let icon: URI | undefined;
		if ((colorThemeType === ColorScheme.LIGHT || colorThemeType === ColorScheme.HIGH_CONTRAST_LIGHT) && iconProp.light) {
			icon = iconProp.light;
		} else if ((colorThemeType === ColorScheme.DARK || colorThemeType === ColorScheme.HIGH_CONTRAST_DARK) && iconProp.dark) {
			icon = iconProp.dark;
		} else {
			// Fallback to the dark icon if the light icon is not available.
			icon = iconProp.light ?? iconProp.dark;
		}

		// Build the icon style.
		const iconStyle: React.CSSProperties = {};
		if (icon) {
			iconStyle.width = '16px';
			iconStyle.height = '16px';
			iconStyle.backgroundSize = '16px';
			iconStyle.backgroundPosition = '50%';
			iconStyle.backgroundRepeat = 'no-repeat';
			iconStyle.backgroundImage = asCSSUrl(icon);
		}

		return (
			<div
				ref={ref}
				className={className}
				style={{ ...style, ...iconStyle }}
				{...rest}
			/>
		);
	}
);

/**
 * Icon component - renders an icon with theme-aware styling.
 * Conditionally renders either a ThemeIcon (codicon-based) or URIIcon (URI-based with dark/light variants).
 * @param props The component properties.
 * @returns The rendered component.
 */
export const Icon = React.forwardRef<HTMLDivElement, IconProps>(
	({ icon, ...rest }, ref) => {
		if (ThemeIconClass.isThemeIcon(icon)) {
			return <ThemeIcon ref={ref} icon={icon} {...rest} />;
		} else {
			return <URIIcon ref={ref} icon={icon} {...rest} />;
		}
	}
);

/** An icon representing a developer error. */
export const DevErrorIcon = () => {
	// Blank icon with an easy-to-catch background color for debugging
	return <ThemeIcon
		icon={Codicon.blank}
		style={{ backgroundColor: asCssVariable(editorErrorForeground) }}
	/>;
};
