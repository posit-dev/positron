/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PositronVariablesEnvironment } from './positronVariablesContext.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IPositronVariablesInstance } from '../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';

/**
 * PositronVariablesState interface.
 */
export interface PositronVariablesState extends PositronVariablesEnvironment {
	readonly positronVariablesInstances: IPositronVariablesInstance[];
	readonly activePositronVariablesInstance?: IPositronVariablesInstance;
}

/**
 * The usePositronVariablesState custom hook.
 * @returns The hook.
 */
export const usePositronVariablesState = (positronVariablesEnvironment: PositronVariablesEnvironment): PositronVariablesState => {
	// Hooks.
	const services = usePositronReactServicesContext();
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
			if ((positronVariablesInstances.find(i => i.session.sessionId === positronVariablesInstance.session.sessionId)) === undefined) {
				// if this instance is already known, it's a restart so activate it
				// activating through the service ensures all listeners are notified
				services.positronVariablesService.setActivePositronVariablesSession(positronVariablesInstance.session.sessionId);
			}
			setPositronVariablesInstances(services.positronVariablesService.positronVariablesInstances);
		}));

		// Add the onDidStopPositronVariablesInstance event handler.
		disposableStore.add(services.positronVariablesService.onDidStopPositronVariablesInstance(_positronVariablesInstance => {
			setPositronVariablesInstances(services.positronVariablesService.positronVariablesInstances);
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
		...positronVariablesEnvironment,
		positronVariablesInstances: positronVariablesInstances,
		activePositronVariablesInstance: activePositronVariablesInstance
	};
};
