/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren, createContext, useContext } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronPreviewServices, PositronPreviewState, usePositronPreviewState } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewState';

/**
 * Create the Positron preview context.
 */
const PositronPreviewContext = createContext<PositronPreviewState>(undefined!);

/**
 * Export the PositronPreviewContextProvider provider
 */
export const PositronPreviewContextProvider = (props: PropsWithChildren<PositronPreviewServices>) => {
	// Hooks.
	const positronPreviewState = usePositronPreviewState(props);

	// Render.
	return (
		<PositronPreviewContext.Provider value={positronPreviewState}>
			{props.children}
		</PositronPreviewContext.Provider>
	);
};

/**
 * Export usePositronPreviewContext to simplify using the Positron preview context object.
 */
export const usePositronPreviewContext = () => useContext(PositronPreviewContext);
