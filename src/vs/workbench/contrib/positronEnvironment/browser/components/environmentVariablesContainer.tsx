/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariablesContainer';
import * as React from 'react';
import { PropsWithChildren, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { PixelRatio } from 'vs/base/browser/browser';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IEnvironmentOptions } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironment.contribution';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * EnvironmentVariablesContainer component.
 * @returns The rendered component.
 */
export const EnvironmentVariablesContainer = (props: PropsWithChildren) => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();
	const containerRef = useRef<HTMLDivElement>(undefined!);
	const [fontInfo, setFontInfo] = useState<FontInfo>(undefined!);
	const [renderFixedWidth, setRenderFixedWidth] = useState<boolean>(false);

	// Hooks.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Access the services we need below.
		const configurationService = positronEnvironmentContext.configurationService;

		// Get the code environment options.
		const environmentOptions = configurationService.getValue<IEnvironmentOptions>('environment');

		// Set the fixed width state.
		setRenderFixedWidth(environmentOptions.fixedWidthFont ?? false);

		// Get the code editor options and read the font info.
		const editorOptions = configurationService.getValue<IEditorOptions>('editor');
		setFontInfo(FontMeasurements.readFontInfo(
			BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value)
		));

		// Add the configuration change event handler so we can detect font-related changes in the
		// editor configuration.
		disposableStore.add(
			configurationService.onDidChangeConfiguration(configurationChangeEvent => {
				if (configurationChangeEvent.affectsConfiguration('environment')) {
					const environmentOptions = configurationService.getValue<IEnvironmentOptions>('environment');

					// Set the render fixed width.
					setRenderFixedWidth(environmentOptions.fixedWidthFont ?? false);
				}

				// When something in the editor changes, determine whether it's font-related and, if
				// it is, apply the new font info to the container.
				if (configurationChangeEvent.affectsConfiguration('editor')) {
					if (configurationChangeEvent.affectedKeys.has('editor.fontFamily') ||
						configurationChangeEvent.affectedKeys.has('editor.fontWeight') ||
						configurationChangeEvent.affectedKeys.has('editor.fontSize') ||
						configurationChangeEvent.affectedKeys.has('editor.fontLigatures') ||
						configurationChangeEvent.affectedKeys.has('editor.fontVariations') ||
						configurationChangeEvent.affectedKeys.has('editor.lineHeight') ||
						configurationChangeEvent.affectedKeys.has('editor.letterSpacing')
					) {
						// Get the code editor options and read the font info.
						const fontInfo = FontMeasurements.readFontInfo(
							BareFontInfo.createFromRawSettings(
								configurationService.getValue<IEditorOptions>('editor'),
								PixelRatio.value
							)
						);

						// Set the font info.
						setFontInfo(fontInfo);
					}
				}
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Font effect.
	useEffect(() => {
		if (renderFixedWidth) {
			containerRef.current.style.fontFamily = fontInfo.getMassagedFontFamily();
			containerRef.current.style.fontWeight = fontInfo.fontWeight;
			containerRef.current.style.fontSize = fontInfo.fontSize + 'px';
			containerRef.current.style.fontFeatureSettings = fontInfo.fontFeatureSettings;
			containerRef.current.style.fontVariationSettings = fontInfo.fontVariationSettings;
			containerRef.current.style.lineHeight = fontInfo.lineHeight + 'px';
			containerRef.current.style.letterSpacing = fontInfo.letterSpacing + 'px';
		} else {
			containerRef.current.style.fontFamily = '';
			containerRef.current.style.fontWeight = '';
			containerRef.current.style.fontSize = '';
			containerRef.current.style.fontFeatureSettings = '';
			containerRef.current.style.fontVariationSettings = '';
			containerRef.current.style.lineHeight = '175%';
			containerRef.current.style.letterSpacing = '';
		}
	}, [renderFixedWidth, fontInfo]);

	// Render.
	return (
		<div ref={containerRef}>
			{props.children}
		</div>
	);
};
