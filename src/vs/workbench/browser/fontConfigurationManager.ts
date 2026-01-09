/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../base/browser/dom.js';
import { IDisposable } from '../../base/common/lifecycle.js';
import { PixelRatio } from '../../base/browser/pixelRatio.js';
import { applyFontInfo } from '../../editor/browser/config/domFontInfo.js';
import { FontInfo } from '../../editor/common/config/fontInfo.js';
import { FontMeasurements } from '../../editor/browser/config/fontMeasurements.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { createBareFontInfoFromRawSettings } from '../../editor/common/config/fontInfoFromSettings.js';

/**
 * Font options interface. Any component that needs to provide font options can define configuration settings
 * matching this interface. Like the editor, fontLigatures and fontVariations can be either booleans for simple
 * on/off control, or strings for fine-grained control of CSS font-feature-settings and font-variation-settings.
 */
export interface IFontOptions {
	/**
	 * The font family.
	 */
	fontFamily?: string;

	/**
	 * Configures font ligatures or font features. Can be either a boolean to enable/disable ligatures
	 * or a string for the value of the CSS 'font-feature-settings' property.
	 */
	fontLigatures?: boolean | string;

	/**
	 * The font size
	 */
	fontSize?: number;

	/**
	 * Configures font variations. Can be either a boolean to enable/disable the translation from
	 * font-weight to font-variation-settings or a string for the value of the CSS
	 * 'font-variation-settings' property.
	 */
	fontVariations?: boolean | string;

	/**
	 * The font weight
	 */
	fontWeight?: string;

	/**
	 * The letter spacing
	 */
	letterSpacing?: number;

	/**
	 * The line height
	 */
	lineHeight?: number;
}

/**
 * FontConfigurationManager class. This class provides methods to manage font configurations
 * in the workbench, including getting font info and applying it to elements.
 */
export class FontConfigurationManager {
	/**
	 * Gets the font info for the specified configuration section.
	 * @param configurationService The configuration service.
	 * @param configurationSection The configuration section (e.g. 'editor', 'console').
	 * @param container The optional container element.
	 * @returns The font info for the specified configuration section.
	 */
	public static getFontInfo(
		configurationService: IConfigurationService,
		configurationSection: string,
		container: HTMLElement | undefined = undefined
	): FontInfo {
		// Get the font options for the specified configuration section.
		const fontOptions = configurationService.getValue<IFontOptions>(configurationSection);

		// Use the container to get the window, if it's available. Otherwise, use the active window.
		const window = container ?
			DOM.getActiveWindow() :
			DOM.getWindow(container);

		// Return the font info for the window.
		return FontMeasurements.readFontInfo(
			window,
			createBareFontInfoFromRawSettings(fontOptions, PixelRatio.getInstance(window).value)
		);
	}

	/**
	 * Font configuration watcher. Watches for font configuration changes in the specified configuration
	 * section and applies the font info to the specified element.
	 * @param configurationService The configuration service.
	 * @param configurationSection The configuration section (e.g. 'editor', 'console').
	 * @param element The element to apply the font info to.
	 * @returns A disposable that should be disposed when the font configuration watcher is no longer needed.
	 */
	public static fontConfigurationWatcher(
		configurationService: IConfigurationService,
		configurationSection: string,
		element: HTMLElement,
		fontInfoChangedCallback?: (fontInfo: FontInfo) => void
	): IDisposable {
		// Apply the initial font info to the element.
		applyFontInfo(element, FontConfigurationManager.getFontInfo(configurationService, configurationSection, element));

		// Add the onDidChangeConfiguration event handler.
		return configurationService.onDidChangeConfiguration(configurationChangeEvent => {
			// When the configuration section changes, determine whether it's font-related and, if it is,
			// apply the updated font info to the element.
			if (configurationChangeEvent.affectsConfiguration(configurationSection)) {
				if (configurationChangeEvent.affectedKeys.has(`${configurationSection}.fontFamily`) ||
					configurationChangeEvent.affectedKeys.has(`${configurationSection}.fontLigatures`) ||
					configurationChangeEvent.affectedKeys.has(`${configurationSection}.fontSize`) ||
					configurationChangeEvent.affectedKeys.has(`${configurationSection}.fontVariations`) ||
					configurationChangeEvent.affectedKeys.has(`${configurationSection}.fontWeight`) ||
					configurationChangeEvent.affectedKeys.has(`${configurationSection}.letterSpacing`) ||
					configurationChangeEvent.affectedKeys.has(`${configurationSection}.lineHeight`)
				) {
					// Get the font info for the specified configuration section.
					const fontInfo = FontConfigurationManager.getFontInfo(configurationService, configurationSection, element);

					// Apply the font info to the element.
					applyFontInfo(element, fontInfo);

					// Call the font info changed callback, if provided.
					if (fontInfoChangedCallback) {
						fontInfoChangedCallback(fontInfo);
					}
				}
			}
		});
	}
}
