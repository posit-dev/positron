/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';
import { IPositronVariablesInstance } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { INotificationService } from 'vs/platform/notification/common/notification';

/**
 * PositronVariablesServices interface.
 */
export interface PositronVariablesServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly positronVariablesService: IPositronVariablesService;
	readonly reactComponentContainer: IReactComponentContainer;
	readonly dataExplorerService: IPositronDataExplorerService;
	readonly notificationService: INotificationService;
}

/**
 * PositronVariablesState interface.
 */
export interface PositronVariablesState extends PositronVariablesServices {
	readonly positronVariablesInstances: IPositronVariablesInstance[];
	readonly activePositronVariablesInstance?: IPositronVariablesInstance;
}

/**
 * The usePositronVariablesState custom hook.
 * @returns The hook.
 */
export const usePositronVariablesState = (services: PositronVariablesServices): PositronVariablesState => {
	// Hooks.
	const [positronVariablesInstances, setPositronVariablesInstances] =
		useState<IPositronVariablesInstance[]>(
			services.positronVariablesService.positronVariablesInstances
		);
	const [activePositronVariablesInstance, setActivePositronVariablesInstance] =
		useState<IPositronVariablesInstance | undefined>(
			services.positronVariablesService.activePositronVariablesInstance
		);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidStartPositronVariablesInstance event handler.
		disposableStore.add(services.positronVariablesService.onDidStartPositronVariablesInstance(positronVariablesInstance => {
			setPositronVariablesInstances(positronVariablesInstances => [...positronVariablesInstances, positronVariablesInstance]);
		}));

		// Add the onDidChangeActivePositronVariablesInstance event handler.
		disposableStore.add(services.positronVariablesService.onDidChangeActivePositronVariablesInstance(positronVariablesInstance => {
			setActivePositronVariablesInstance(positronVariablesInstance);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	});

	// Return the Positron variables state.
	return {
		...services,
		positronVariablesInstances: positronVariablesInstances,
		activePositronVariablesInstance: activePositronVariablesInstance
	};
};
