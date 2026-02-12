/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editorActionBar.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isAuxiliaryWindow } from '../../../../base/browser/window.js';
import { EditorActionBarFactory } from './editorActionBarFactory.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { PositronActionBarContextProvider } from '../../../../platform/positronActionBar/browser/positronActionBarContext.js';

/**
 * EditorActionBarProps interface
 */
interface EditorActionBarProps {
	readonly editorActionBarFactory: EditorActionBarFactory;
}

/**
 * EditorActionBar component.
 * @returns The rendered component.
 */
export const EditorActionBar = (props: EditorActionBarProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [, setRenderMarker] = useState(1);

	// Menu manager effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidActionsChange event handler.
		disposableStore.add(props.editorActionBarFactory.onDidActionsChange(() => {
			// Re-render the component.
			setRenderMarker(renderCounter => renderCounter + 1);
		}));

		// Add the onDidColorThemeChange event handler.
		disposableStore.add(services.themeService.onDidColorThemeChange(() => {
			// Re-render the component.
			setRenderMarker(renderCounter => renderCounter + 1);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.editorActionBarFactory, services.themeService]);

	// Determine whether the window is an auxiliary window.
	const auxiliaryWindow = ref.current ? isAuxiliaryWindow(DOM.getWindow(ref.current)) : undefined;

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div ref={ref} className='editor-action-bar'>
				{props.editorActionBarFactory.create(auxiliaryWindow)}
			</div>
		</PositronActionBarContextProvider>
	);
};
