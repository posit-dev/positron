/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { ILogService } from 'vs/platform/log/common/log';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IModelService } from 'vs/editor/common/services/model';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { IPositronConsoleInstance, IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';

/**
 * PositronConsoleServices interface. Defines the set of services that are required by the Positron
 * console.
 */
export interface PositronConsoleServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
	readonly executionHistoryService: IExecutionHistoryService;
	readonly instantiationService: IInstantiationService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly languageService: ILanguageService;
	readonly logService: ILogService;
	readonly modelService: IModelService;
	readonly notificationService: INotificationService;
	readonly openerService: IOpenerService;
	readonly positronConsoleService: IPositronConsoleService;
	readonly positronPlotsService: IPositronPlotsService;
	readonly viewsService: IViewsService;
	readonly workbenchLayoutService: IWorkbenchLayoutService;
}

/**
 * The Positron console state.
 */
export interface PositronConsoleState extends PositronConsoleServices {
	readonly positronConsoleInstances: IPositronConsoleInstance[];
	readonly activePositronConsoleInstance?: IPositronConsoleInstance;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (services: PositronConsoleServices): PositronConsoleState => {
	// Hooks.
	const [positronConsoleInstances, setPositronConsoleInstances] = useState<IPositronConsoleInstance[]>(
		services.positronConsoleService.positronConsoleInstances
	);
	const [activePositronConsoleInstance, setActivePositronConsoleInstance] = useState<IPositronConsoleInstance | undefined>(
		services.positronConsoleService.activePositronConsoleInstance
	);

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
			setActivePositronConsoleInstance(positronConsoleInstance);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron console state.
	return {
		...services,
		positronConsoleInstances,
		activePositronConsoleInstance: activePositronConsoleInstance
	};
};
