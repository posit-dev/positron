/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

const React = require('react');
import { PropsWithChildren, createContext, useContext } from 'react';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { PositronTopBarState, usePositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarState';

/**
 * Create the Positron top bar context.
 */
const PositronTopBarContext = createContext<PositronTopBarState>(undefined!);

/**
 * Export the PositronTopBarContextProvider provider
 */
export const PositronTopBarContextProvider = (props: PropsWithChildren<PositronTopBarServices>) => {
	// Hooks.
	const positronTopBarState = usePositronTopBarState(props);

	// Render.
	return (
		<PositronTopBarContext.Provider value={positronTopBarState}>
			{props.children}
		</PositronTopBarContext.Provider>
	);
};

/**
 * Export useQuartoPubContext to simplify using the Positron top bar context object.
 */
export const usePositronTopBarContext = () => useContext(PositronTopBarContext);
