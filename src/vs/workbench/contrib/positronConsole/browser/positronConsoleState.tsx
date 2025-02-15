/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { ILogService } from '../../../../platform/log/common/log.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { PositronActionBarServices } from '../../../../platform/positronActionBar/browser/positronActionBarState.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IExecutionHistoryService } from '../../executionHistory/common/executionHistoryService.js';
import { IPositronConsoleInstance, IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

/**
 * PositronConsoleServices interface. Defines the set of services that are required by the Positron
 * console.
 */
export interface PositronConsoleServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
	readonly executionHistoryService: IExecutionHistoryService;
	readonly instantiationService: IInstantiationService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly runtimeStartupService: IRuntimeStartupService;
	readonly languageService: ILanguageService;
	readonly logService: ILogService;
	readonly modelService: IModelService;
	readonly notificationService: INotificationService;
	readonly openerService: IOpenerService;
	readonly positronConsoleService: IPositronConsoleService;
	readonly positronPlotsService: IPositronPlotsService;
	readonly viewsService: IViewsService;
	readonly workbenchLayoutService: IWorkbenchLayoutService;
	readonly contextKeyService: IContextKeyService;
	readonly commandService: ICommandService;
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
	}, [services.positronConsoleService]);

	// Return the Positron console state.
	return {
		...services,
		positronConsoleInstances,
		activePositronConsoleInstance: activePositronConsoleInstance
	};
};
