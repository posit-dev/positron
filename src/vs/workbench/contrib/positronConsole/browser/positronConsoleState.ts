/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IModelService } from 'vs/editor/common/services/model';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ConsoleReplInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplInstance';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';

/**
 * PositronConsoleServices interface. Defines the set of services that are required by the Positron console.
 */
export interface PositronConsoleServices {
	readonly executionHistoryService: IExecutionHistoryService;
	readonly instantiationService: IInstantiationService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly languageService: ILanguageService;
	readonly modelService: IModelService;
	readonly positronConsoleService: IPositronConsoleService;
}

/**
 * The Positron console state.
 */
export interface PositronConsoleState extends PositronConsoleServices {
	readonly consoleReplInstances: ConsoleReplInstance[];
	readonly currentConsoleReplInstance?: ConsoleReplInstance;
	setCurrentConsoleReplInstance: (consoleInstance?: ConsoleReplInstance) => void;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (services: PositronConsoleServices): PositronConsoleState => {
	// Hooks.
	const [consoleReplInstances, setConsoleReplInstances, refConsoleReplInstances] = useStateRef<ConsoleReplInstance[]>([]);
	const [currentConsoleReplInstance, setCurrentConsoleReplInstance] = useState<ConsoleReplInstance | undefined>(undefined);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// If there are already repl instances in the repl service, create their repl instance entries.
		services.positronConsoleService.instances.forEach((replInstance, index, replInstances) => {
		});

		// Add the onDidStartRepl event handler.
		disposableStore.add(services.positronConsoleService.onDidStartConsole(positronConsoleInstance => {
			// Create and add the Positron language environment.
			const consoleInstance = new ConsoleReplInstance(positronConsoleInstance);
			setConsoleReplInstances(consoleInstances => [...consoleInstances, consoleInstance]);
		}));

		// Add the onDidChangeActiveRepl event handler.
		disposableStore.add(services.positronConsoleService.onDidChangeActiveConsole(positronConsoleInstance => {
			if (!positronConsoleInstance) {
				setCurrentConsoleReplInstance(undefined);
			} else {
				setCurrentConsoleReplInstance(refConsoleReplInstances.current.find(x => x.positronConsoleInstance.languageId === positronConsoleInstance.languageId));
			}
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron console state.
	return {
		...services,
		consoleReplInstances,
		currentConsoleReplInstance,
		setCurrentConsoleReplInstance
	};
};
