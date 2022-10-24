/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren, createContext, useContext } from 'react';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { PositronTopBarState, usePositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarState';

/**
 * PositronTopBarContextProviderProps interface.
 */
interface PositronTopBarContextProviderProps extends PropsWithChildren<PositronTopBarServices> {
	commandIds: string[];
}

/**
 * Create the Positron top bar context.
 */
const PositronTopBarContext = createContext<PositronTopBarState | undefined>(undefined);

/**
 * Export the PositronTopBarContextProvider provider
 */
export const PositronTopBarContextProvider = (props: PositronTopBarContextProviderProps) => {
	// Hooks.
	const positronTopBarState = usePositronTopBarState({ ...props }, props.commandIds);

	// Render.
	return (
		<PositronTopBarContext.Provider value={positronTopBarState}>
			{props.children}
		</PositronTopBarContext.Provider>
	);
};

// Export useQuartoPubContext to simplify using the Positron top bar context object.
export const usePositronTopBarContext = () => useContext(PositronTopBarContext);
