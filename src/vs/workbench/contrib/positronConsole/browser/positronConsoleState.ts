/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { IReplService } from 'vs/workbench/contrib/repl/browser/repl';
import { ConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleInstance';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronConsoleServices interface. Defines the set of services that are required by the Positron console.
 */
export interface PositronConsoleServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly replService: IReplService;
}

/**
 * The Positron console state.
 */
export interface PositronConsoleState extends PositronConsoleServices {
	readonly consoleInstances: ConsoleInstance[];
	readonly currentConsoleInstance?: ConsoleInstance;
	setCurrentConsoleInstance: (consoleInstance?: ConsoleInstance) => void;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (services: PositronConsoleServices): PositronConsoleState => {
	// Hooks.
	const [consoleInstances, setConsoleInstances, refConsoleInstances] = useStateRef<ConsoleInstance[]>([]);
	const [currentConsoleInstance, setCurrentConsoleInstance] = useState<ConsoleInstance | undefined>(undefined);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// If there are already repl instances in the repl service, create their repl instance entries.
		services.replService.instances.forEach((replInstance, index, replInstances) => {
		});

		// Add the onDidStartRepl event handler.
		disposableStore.add(services.replService.onDidStartRepl(replInstance => {
			// Create and add the Positron language environment.
			const consoleInstance = new ConsoleInstance(replInstance);
			setConsoleInstances(consoleInstances => [...consoleInstances, consoleInstance]);
		}));

		// Add the onDidChangeActiveRepl event handler.
		disposableStore.add(services.replService.onDidChangeActiveRepl(replInstance => {
			if (!replInstance) {
				setCurrentConsoleInstance(undefined);
			} else {
				setCurrentConsoleInstance(refConsoleInstances.current.find(x => x.replInstance.languageId === replInstance.languageId));
			}
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron console state.
	return {
		...services,
		consoleInstances,
		currentConsoleInstance,
		setCurrentConsoleInstance
	};
};
