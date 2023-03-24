/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariablesContainer';
import * as React from 'react';
import { PropsWithChildren, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { PixelRatio } from 'vs/base/browser/browser';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * EnvironmentVariablesContainer component.
 * @returns The rendered component.
 */
export const EnvironmentVariablesContainer = (props: PropsWithChildren) => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();
	const containerRef = useRef<HTMLDivElement>(undefined!);

	// Hooks.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Access the services we need below.
		const configurationService = positronEnvironmentContext.configurationService;

		// Get the code editor options and read the font info.
		const editorOptions = configurationService.getValue<IEditorOptions>('editor');
		const fontInfo = FontMeasurements.readFontInfo(
			BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value)
		);

		// Apply the font info to the container.
		applyFontInfo(containerRef.current, fontInfo);

		// Add the configuration change event handler so we can detect font-related changes in the
		// editor configuration.
		disposableStore.add(
			configurationService.onDidChangeConfiguration(configurationChangeEvent => {
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

						// Apply the font info to the container.
						applyFontInfo(containerRef.current, fontInfo);
					}
				}
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	});

	// Render.
	return (
		<div ref={containerRef}>
			{props.children}
		</div>
	);
};
