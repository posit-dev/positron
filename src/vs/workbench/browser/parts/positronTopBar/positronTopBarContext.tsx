/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren, createContext, useContext } from 'react';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { usePositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/usePositronTopBarState';
import type { PositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarState';

/**
 * Create the Positron top bar context.
 */
const positronTopBarContext = createContext<PositronTopBarState | undefined>(undefined);

// Export the PositronTopBarContextProvider provider.
export const PositronTopBarContextProvider = (props: PropsWithChildren<PositronTopBarServices>) => {
	// Hooks.
	const positronTopBarState = usePositronTopBarState({ ...props });

	// Render.
	return (
		<positronTopBarContext.Provider value={positronTopBarState}>
			{props.children}
		</positronTopBarContext.Provider>
	);
};

// Export useQuartoPubContext to simplify using the context object.
export const usePositronTopBarContext = () => useContext(positronTopBarContext);
