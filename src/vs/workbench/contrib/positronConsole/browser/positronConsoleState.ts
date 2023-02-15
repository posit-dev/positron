/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { ILogService } from 'vs/platform/log/common/log';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IModelService } from 'vs/editor/common/services/model';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsoleService';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/positronConsoleInstance';

/**
 * PositronConsoleServices interface. Defines the set of services that are required by the Positron console.
 */
export interface PositronConsoleServices {
	readonly executionHistoryService: IExecutionHistoryService;
	readonly instantiationService: IInstantiationService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly languageService: ILanguageService;
	readonly logService: ILogService;
	readonly modelService: IModelService;
	readonly positronConsoleService: IPositronConsoleService;
}

/**
 * The Positron console state.
 */
export interface PositronConsoleState extends PositronConsoleServices {
	readonly positronConsoleInstances: IPositronConsoleInstance[];
	readonly currentPositronConsoleInstance?: IPositronConsoleInstance;
	setCurrentPositronConsoleInstance: (positronConsoleInstance?: IPositronConsoleInstance) => void;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (services: PositronConsoleServices): PositronConsoleState => {
	// Hooks.
	const [positronConsoleInstances, setPositronConsoleInstances, refPositronConsoleInstances] = useStateRef<IPositronConsoleInstance[]>(services.positronConsoleService.positronConsoleInstances);
	const [currentPositronConsoleInstance, setCurrentPositronConsoleInstance] = useState<IPositronConsoleInstance | undefined>(positronConsoleInstances.find(_ => _.runtime.metadata.runtimeId === services.positronConsoleService.activePositronConsoleInstance?.runtime.metadata.runtimeId));

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidStartPositronConsoleInstance event handler.
		disposableStore.add(services.positronConsoleService.onDidStartPositronConsoleInstance(positronConsoleInstance => {
			setPositronConsoleInstances(positronConsoleInstances => [...positronConsoleInstances, positronConsoleInstance]);
		}));

		// Add the onDidChangeActivePositronConsoleInstance event handler.
		disposableStore.add(services.positronConsoleService.onDidChangeActivePositronConsoleInstance(positronConsoleInstance => {
			if (!positronConsoleInstance) {
				setCurrentPositronConsoleInstance(undefined);
			} else {
				const positronConsoleInstance = refPositronConsoleInstances.current.find(_ => _.runtime.metadata.languageId === _.runtime.metadata.languageId);
				setCurrentPositronConsoleInstance(positronConsoleInstance);
			}
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron console state.
	return {
		...services,
		positronConsoleInstances,
		currentPositronConsoleInstance,
		setCurrentPositronConsoleInstance
	};
};
