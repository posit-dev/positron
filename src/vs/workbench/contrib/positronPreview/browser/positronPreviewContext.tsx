/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { PositronPreviewServices, PositronPreviewState, usePositronPreviewState } from './positronPreviewState.js';

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
