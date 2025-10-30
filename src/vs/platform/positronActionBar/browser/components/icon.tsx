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

/**
 * IconProps interface.
 */
interface IconProps {
	readonly icon: IconType;
	readonly className?: string;
}

/**
 * ThemeIconProps interface.
 */
interface ThemeIconProps {
	readonly icon: ThemeIconClass;
	readonly className?: string;
}

/**
 * URIIconProps interface.
 */
interface URIIconProps {
	readonly icon: { dark?: URI; light?: URI };
	readonly className?: string;
}

/**
 * ThemeIcon component - renders a codicon-based theme icon.
 * @param props The component properties.
 * @returns The rendered component.
 */
const ThemeIcon = (props: ThemeIconProps) => {
	const iconClassNames = ThemeIconClass.asClassNameArray(props.icon);

	return (
		<div
			className={positronClassNames(props.className, ...iconClassNames)}
		/>
	);
};

/**
 * URIIcon component - renders a URI-based icon with theme-aware dark/light variants.
 * @param props The component properties.
 * @returns The rendered component.
 */
const URIIcon = (props: URIIconProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Get the color theme type.
	const colorThemeType = services.themeService.getColorTheme().type;

	// Determine the CSS background image based on the color theme type and icon.
	let icon: URI | undefined;
	if ((colorThemeType === ColorScheme.LIGHT || colorThemeType === ColorScheme.HIGH_CONTRAST_LIGHT) && props.icon.light) {
		icon = props.icon.light;
	} else if ((colorThemeType === ColorScheme.DARK || colorThemeType === ColorScheme.HIGH_CONTRAST_DARK) && props.icon.dark) {
		icon = props.icon.dark;
	} else {
		// Fallback to the dark icon if the light icon is not available.
		icon = props.icon.light ?? props.icon.dark;
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
			className={props.className}
			style={iconStyle}
		/>
	);
};

/**
 * Icon component - renders an icon with theme-aware styling.
 * Conditionally renders either a ThemeIcon (codicon-based) or URIIcon (URI-based with dark/light variants).
 * @param props The component properties.
 * @returns The rendered component.
 */
export const Icon = (props: IconProps) => {
	if (ThemeIconClass.isThemeIcon(props.icon)) {
		return <ThemeIcon className={props.className} icon={props.icon} />;
	} else {
		return <URIIcon className={props.className} icon={props.icon} />;
	}
};
