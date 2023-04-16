/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronEnvironmentInstance, IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * PositronEnvironmentServices interface. Defines the set of services that are required by the Positron environment.
 */
export interface PositronEnvironmentServices {
	readonly clipboardService: IClipboardService;
	readonly configurationService: IConfigurationService;
	readonly contextMenuService: IContextMenuService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly positronEnvironmentService: IPositronEnvironmentService;
}

/**
 * The Positron environment state.
 */
export interface PositronEnvironmentState extends PositronEnvironmentServices {
	readonly positronEnvironmentInstances: IPositronEnvironmentInstance[];
	readonly activePositronEnvironmentInstance?: IPositronEnvironmentInstance;
}

/**
 * The usePositronEnvironmentState custom hook.
 * @returns The hook.
 */
export const usePositronEnvironmentState = (services: PositronEnvironmentServices): PositronEnvironmentState => {
	// Hooks.
	const [positronEnvironmentInstances, setPositronEnvironmentInstances] =
		useState<IPositronEnvironmentInstance[]>(
			services.positronEnvironmentService.positronEnvironmentInstances
		);
	const [activePositronEnvironmentInstance, setActivePositronEnvironmentInstance] =
		useState<IPositronEnvironmentInstance | undefined>(
			services.positronEnvironmentService.activePositronEnvironmentInstance
		);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidStartPositronEnvironmentInstance event handler.
		disposableStore.add(services.positronEnvironmentService.onDidStartPositronEnvironmentInstance(positronEnvironmentInstance => {
			setPositronEnvironmentInstances(positronEnvironmentInstances => [...positronEnvironmentInstances, positronEnvironmentInstance]);
		}));

		// Add the onDidChangeActivePositronEnvironmentInstance event handler.
		disposableStore.add(services.positronEnvironmentService.onDidChangeActivePositronEnvironmentInstance(positronEnvironmentInstance => {
			setActivePositronEnvironmentInstance(positronEnvironmentInstance);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron environment state.
	return {
		...services,
		positronEnvironmentInstances,
		activePositronEnvironmentInstance
	};
};
