/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronConsoleServices interface. Defines the set of services that are required by the Positron console.
 */
export interface PositronConsoleServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
}

/**
 * The Positron console state.
 */
export interface PositronConsoleState extends PositronConsoleServices {
	readonly test?: number;
	setTest: (test: number) => void;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (services: PositronConsoleServices): PositronConsoleState => {
	// Hooks.
	const [test, setTest, _refTest] = useStateRef<number>(0);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron console state.
	return {
		...services,
		test,
		setTest
	};
};
