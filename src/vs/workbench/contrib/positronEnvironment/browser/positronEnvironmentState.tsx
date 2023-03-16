/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { LanguageEnvironment } from 'vs/workbench/contrib/positronEnvironment/browser/classes/languageEnvironment';
import { IPositronEnvironmentInstance, IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * PositronEnvironmentServices interface. Defines the set of services that are required by the Positron environment.
 */
export interface PositronEnvironmentServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly positronEnvironmentService: IPositronEnvironmentService;
}

/**
 * The Positron environment state.
 */
export interface PositronEnvironmentState extends PositronEnvironmentServices {
	readonly positronEnvironmentInstances: IPositronEnvironmentInstance[];
	readonly activePositronEnvironmentInstance?: IPositronEnvironmentInstance;

	// Do die soon.
	readonly languageEnvironments: LanguageEnvironment[];
	readonly currentLanguageEnvironment?: LanguageEnvironment;
	setCurrentLanguageEnvironment: (languageEnvironment?: LanguageEnvironment) => void;
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

	// To die soon.
	const [languageEnvironments, setLanguageEnvironments, refLanguageEnvironments] = useStateRef<LanguageEnvironment[]>([]);
	const [currentLanguageEnvironment, setCurrentLanguageEnvironment] = useState<LanguageEnvironment | undefined>(undefined);

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

		// TO DIE
		// Add the did start runtime event handler for the language runtime service.
		disposableStore.add(services.languageRuntimeService.onDidStartRuntime(runtime => {
			// Create and add the Positron language environment.
			const languageEnvironment = new LanguageEnvironment(runtime);
			setLanguageEnvironments(languageEnvironments => [...languageEnvironments, languageEnvironment]);
			disposableStore.add(languageEnvironment);


		}));

		// TO DIE
		// Add the did change active runtime event handler for the language runtime service.
		disposableStore.add(services.languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				setCurrentLanguageEnvironment(undefined);
			} else {
				const languageEnvironment = refLanguageEnvironments.current.find(languageEnvironment =>
					languageEnvironment.runtime.metadata.runtimeId === runtime.metadata.runtimeId
				);

				if (languageEnvironment) {
					setCurrentLanguageEnvironment(languageEnvironment);
				}
			}
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron environment state.
	return {
		...services,
		positronEnvironmentInstances,
		activePositronEnvironmentInstance,
		languageEnvironments,
		currentLanguageEnvironment,
		setCurrentLanguageEnvironment
	};
};
