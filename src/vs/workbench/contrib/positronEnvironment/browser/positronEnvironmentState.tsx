/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';

/**
 * The Positron environment view mode.
 */
export enum PositronEnvironmentViewMode {
	/**
	 * List environment view mode.
	 */
	List = 0,

	/**
	 * Grid environment view mode.
	 */
	Grid = 1
}

/**
 * The Positron environment state.
 */
export interface PositronEnvironmentState {
	environmentViewMode: PositronEnvironmentViewMode;
	setEnvironmentViewMode: (environmentViewMode: PositronEnvironmentViewMode) => void;
}

/**
 * The usePositronEnvironmentState custom hook.
 * @returns The hook.
 */
export const usePositronEnvironmentState = (): PositronEnvironmentState => {
	// Hooks.
	const [environmentViewMode, setEnvironmentViewMode] = useState(PositronEnvironmentViewMode.List);

	// Add event handlers.
	useEffect(() => {
	}, []);

	// Return the Positron environment state.
	return {
		environmentViewMode,
		setEnvironmentViewMode
	};
};
