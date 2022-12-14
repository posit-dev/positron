/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronEnvironmentServices interface. Defines the set of services that are required by the Positron environment.
 */
export interface PositronEnvironmentServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
}

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
export interface PositronEnvironmentState extends PositronEnvironmentServices {
	environmentViewMode: PositronEnvironmentViewMode;
	setEnvironmentViewMode: (environmentViewMode: PositronEnvironmentViewMode) => void;
}

/**
 * The usePositronEnvironmentState custom hook.
 * @returns The hook.
 */
export const usePositronEnvironmentState = (services: PositronEnvironmentServices): PositronEnvironmentState => {
	// Hooks.
	const [environmentViewMode, setEnvironmentViewMode] = useState(PositronEnvironmentViewMode.List);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the did start runtime event handler.
		disposableStore.add(services.languageRuntimeService.onDidStartRuntime(languageRuntime => {
			console.log(`********************* onDidStartRuntime ${languageRuntime.metadata.name}`);

			disposableStore.add(languageRuntime.onDidCompleteStartup(languageRuntimeInfo => {
				console.log(`********************* onDidCompleteStartup ${languageRuntime.metadata.language}`);

			}));
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron environment state.
	return {
		...services,
		environmentViewMode,
		setEnvironmentViewMode
	};
};
