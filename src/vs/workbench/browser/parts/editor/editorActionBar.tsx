/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./editorActionBar';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { isAuxiliaryWindow } from 'vs/base/browser/window';
import { EditorActionBarFactory } from 'vs/workbench/browser/parts/editor/editorActionBarFactory';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * EditorActionBarServices interface.
 */
interface EditorActionBarServices extends PositronActionBarServices {
}

/**
 * EditorActionBarProps interface
 */
interface EditorActionBarProps extends EditorActionBarServices {
	readonly editorActionBarFactory: EditorActionBarFactory;
}

/**
 * EditorActionBar component.
 * @returns The rendered component.
 */
export const EditorActionBar = (props: EditorActionBarProps) => {
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

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props.editorActionBarFactory]);

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
