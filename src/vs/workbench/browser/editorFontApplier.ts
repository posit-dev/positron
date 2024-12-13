/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../base/browser/dom.js';
import { PixelRatio } from '../../base/browser/pixelRatio.js';
import { BareFontInfo } from '../../editor/common/config/fontInfo.js';
import { applyFontInfo } from '../../editor/browser/config/domFontInfo.js';
import { IEditorOptions } from '../../editor/common/config/editorOptions.js';
import { FontMeasurements } from '../../editor/browser/config/fontMeasurements.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';

/**
 * Applies the editor font info to the specified element.
 * @param configurationService The configuration service.
 * @param element The element to apply the editor font info to.
 */
const applyEditorFontInfoToElement = (
	configurationService: IConfigurationService,
	element: HTMLElement,
) => {
	// Get the editor options.
	const editorOptions = configurationService.getValue<IEditorOptions>('editor');

	// Get the window.
	const window = DOM.getWindow(element);

	// Get the editor font info for the window.
	const fontInfo = FontMeasurements.readFontInfo(
		window,
		BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.getInstance(window).value)
	);

	// Apply the editor font info to the element.
	applyFontInfo(element, fontInfo);
};

/**
 * Editor font applier.
 * @param configurationService The configuration service.
 * @param element The element to apply the editor font to.
 * @returns A disposable that should be disposed when the editor font applier is no longer needed.
 */
export const editorFontApplier = (
	configurationService: IConfigurationService,
	element: HTMLElement
) => {
	// Apply the initial editor font info to the rows element.
	applyEditorFontInfoToElement(
		configurationService,
		element
	);

	// Add the onDidChangeConfiguration event handler.
	return configurationService.onDidChangeConfiguration(configurationChangeEvent => {
		// When something in the editor changes, determine whether it's font-related and, if it is,
		// apply the new font info.
		if (configurationChangeEvent.affectsConfiguration('editor')) {
			if (configurationChangeEvent.affectedKeys.has('editor.fontFamily') ||
				configurationChangeEvent.affectedKeys.has('editor.fontWeight') ||
				configurationChangeEvent.affectedKeys.has('editor.fontSize') ||
				configurationChangeEvent.affectedKeys.has('editor.fontLigatures') ||
				configurationChangeEvent.affectedKeys.has('editor.fontVariations') ||
				configurationChangeEvent.affectedKeys.has('editor.lineHeight') ||
				configurationChangeEvent.affectedKeys.has('editor.letterSpacing')
			) {
				// Apply the updated editor font info to the rows element.
				applyEditorFontInfoToElement(
					configurationService,
					element
				);
			}
		}
	});
};
