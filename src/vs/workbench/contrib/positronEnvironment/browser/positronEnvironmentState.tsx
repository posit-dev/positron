/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PositronEnvironmentServices interface. Defines the set of services that are required by the Positron environment.
 */
export interface PositronEnvironmentServices {
	readonly languageRuntimeService: ILanguageRuntimeService;
}

/**
 * The Positron environment view mode.
 */
export enum PositronEnvironmentViewMode {
	/**
	 * List environment view mode.
	 */
	List = 0,

	/**
	 * Grid environment view mode.
	 */
	Grid = 1
}

/**
 * The Positron environment state.
 */
export interface PositronEnvironmentState extends PositronEnvironmentServices {
	readonly languageEnvironments: LanguageEnvironment[];
	readonly currentLanguageEnvironment?: LanguageEnvironment;
	setCurrentLanguageEnvironment: (languageEnvironment?: LanguageEnvironment) => void;
	readonly environmentViewMode: PositronEnvironmentViewMode;
	setEnvironmentViewMode: (environmentViewMode: PositronEnvironmentViewMode) => void;
}

/**
 * LanguageEnvironment class.
 */
export class LanguageEnvironment extends Disposable {
	/**
	 * Constructor.
	 * @param _languageRuntime The ILanguageRuntime.
	 */
	constructor(private readonly _languageRuntime: ILanguageRuntime) {
		// Initialize Disposable base class.
		super();

		// Add the did change runtime state event handler.
		this._register(this._languageRuntime.onDidChangeRuntimeState(runtimeState => {
			console.log(`********************* onDidChangeRuntimeState ${runtimeState}`);
		}));

		// Add the did complete startup event handler.
		this._register(this._languageRuntime.onDidCompleteStartup(languageRuntimeInfo => {
			console.log(`********************* onDidCompleteStartup ${this._languageRuntime.metadata.language}`);
		}));

		// Add the did receive runtime message event handler.
		this._register(this._languageRuntime.onDidReceiveRuntimeMessage(languageRuntimeMessage => {
			console.log(`********************* onDidReceiveRuntimeMessage ${languageRuntimeMessage.id}`);
		}));
	}

	/**
	 * Dispose method.
	 */
	override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();
	}

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		// TODO@softwarenerd - For the moment, just reusing the ID from the metadata.
		return this._languageRuntime.metadata.id;
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		// TODO@softwarenerd - temporary code because R's metadata returns 'r' for the language and 'R: /Library/Frameworks/R.framework/Resources' for the name.
		if (this._languageRuntime.metadata.name.startsWith('R')) {
			return 'R';
		} else {
			return '???';
		}
	}
}

/**
 * The usePositronEnvironmentState custom hook.
 * @returns The hook.
 */
export const usePositronEnvironmentState = (services: PositronEnvironmentServices): PositronEnvironmentState => {
	// Hooks.
	const [environmentViewMode, setEnvironmentViewMode] = useState(PositronEnvironmentViewMode.List);
	const [languageEnvironments, setLanguageEnvironments] = useState<LanguageEnvironment[]>([]);
	const [currentLanguageEnvironment, setCurrentLanguageEnvironment] = useState<LanguageEnvironment | undefined>(undefined);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the did start runtime event handler for the language runtime service.
		disposableStore.add(services.languageRuntimeService.onDidStartRuntime(languageRuntime => {
			// Create and add the Positron language environment.
			const languageEnvironment = new LanguageEnvironment(languageRuntime);
			setLanguageEnvironments([...languageEnvironments, languageEnvironment]);
			disposableStore.add(languageEnvironment);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	useEffect(() => {
	}, [languageEnvironments]);

	// Logging.
	console.log('------------------------------------------------');
	console.log('The current set of language runtime descriptors:');
	for (let i = 0; i < languageEnvironments.length; i++) {
		const languageEnvironment = languageEnvironments[i];
		console.log(`Language ${languageEnvironment.identifier} ${languageEnvironment.displayName}`);
	}
	console.log('------------------------------------------------');

	// Return the Positron environment state.
	return {
		...services,
		languageEnvironments,
		currentLanguageEnvironment,
		setCurrentLanguageEnvironment,
		environmentViewMode,
		setEnvironmentViewMode
	};
};
