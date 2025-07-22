/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IPositronConsoleInstance } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

/**
 * The Positron console state.
 */
export interface PositronConsoleState {
	readonly positronConsoleInstances: IPositronConsoleInstance[];
	readonly activePositronConsoleInstance?: IPositronConsoleInstance;
	readonly consoleSessionListCollapsed: boolean;
}

/**
 * The usePositronConsoleState custom hook.
 * @returns The hook.
 */
export const usePositronConsoleState = (): PositronConsoleState => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Hooks.
	const [positronConsoleInstances, setPositronConsoleInstances] = useState<IPositronConsoleInstance[]>([]);
	const [activePositronConsoleInstance, setActivePositronConsoleInstance] = useState<IPositronConsoleInstance | undefined>(undefined);
	const [consoleSessionListCollapsed, setConsoleSessionListCollapsed] = useState<boolean>(positronConsoleInstances.length <= 1);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Set the initial state of the Positron console instances. This is done
		// in the useEffect hook rather than the constructor; otherwise we miss
		// instances created after the component is constructed but before the
		// component is mounted.
		setPositronConsoleInstances(services.positronConsoleService.positronConsoleInstances);
		setActivePositronConsoleInstance(services.positronConsoleService.activePositronConsoleInstance);

		// Add the onDidStartPositronConsoleInstance event handler.
		disposableStore.add(services.positronConsoleService.onDidStartPositronConsoleInstance(positronConsoleInstance => {
			setPositronConsoleInstances(positronConsoleInstances => [...positronConsoleInstances, positronConsoleInstance]);
		}));

		// Add the onDidChangeActivePositronConsoleInstance event handler.
		disposableStore.add(services.positronConsoleService.onDidChangeActivePositronConsoleInstance(positronConsoleInstance => {
			setActivePositronConsoleInstance(positronConsoleInstance);
		}));

		// Add the onDidDeletePositronConsoleInstance event handler.
		disposableStore.add(services.positronConsoleService.onDidDeletePositronConsoleInstance(positronConsoleInstance => {
			setPositronConsoleInstances(positronConsoleInstances => {
				const instances = [...positronConsoleInstances];
				// Remove the instance from the array.
				const idx = instances.indexOf(positronConsoleInstance);
				if (idx !== -1) {
					instances.splice(idx, 1);
				}
				return instances;
			});
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [services.positronConsoleService, services.runtimeSessionService, setActivePositronConsoleInstance]);

	useEffect(() => {
		setConsoleSessionListCollapsed(positronConsoleInstances.length <= 1);
	}, [positronConsoleInstances]);


	// Return the Positron console state.
	return {
		consoleSessionListCollapsed,
		positronConsoleInstances,
		activePositronConsoleInstance: activePositronConsoleInstance,
	};
};
