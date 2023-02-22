/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { LanguageEnvironment } from 'vs/workbench/contrib/positronEnvironment/browser/classes/languageEnvironment';

/**
 * PositronEnvironmentServices interface. Defines the set of services that are required by the Positron environment.
 */
export interface PositronEnvironmentServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
}

/**
 * The Positron environment state.
 */
export interface PositronEnvironmentState extends PositronEnvironmentServices {
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
	const [languageEnvironments, setLanguageEnvironments, refLanguageEnvironments] = useStateRef<LanguageEnvironment[]>([]);
	const [currentLanguageEnvironment, setCurrentLanguageEnvironment] = useState<LanguageEnvironment | undefined>(undefined);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the did start runtime event handler for the language runtime service.
		disposableStore.add(services.languageRuntimeService.onDidStartRuntime(runtime => {
			// Create and add the Positron language environment.
			const languageEnvironment = new LanguageEnvironment(runtime);
			setLanguageEnvironments(languageEnvironments => [...languageEnvironments, languageEnvironment]);
			disposableStore.add(languageEnvironment);
		}));

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

	// Logging.
	// console.log('------------------------------------------------');
	// console.log('The current set of language runtime descriptors:');
	// for (let i = 0; i < languageEnvironments.length; i++) {
	// 	const languageEnvironment = languageEnvironments[i];
	// 	console.log(`Language ${languageEnvironment.identifier} ${languageEnvironment.displayName}`);
	// }
	// console.log('------------------------------------------------');

	// Return the Positron environment state.
	return {
		...services,
		languageEnvironments,
		currentLanguageEnvironment,
		setCurrentLanguageEnvironment
	};
};
