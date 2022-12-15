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
	environmentViewMode: PositronEnvironmentViewMode;
	setEnvironmentViewMode: (environmentViewMode: PositronEnvironmentViewMode) => void;
}

class LanguageRuntimeDescriptor extends Disposable {

	/**
	 * Constructor.
	 * @param _languageRuntime The ILanguageRuntime.
	 */
	constructor(private readonly _languageRuntime: ILanguageRuntime) {
		// Initialize Disposable base class.
		super();

		this._register(this._languageRuntime.onDidCompleteStartup(languageRuntimeInfo => {
			console.log(`********************* onDidCompleteStartup ${this._languageRuntime.metadata.language}`);
		}));

		this._register(this._languageRuntime.onDidChangeRuntimeState(runtimeState => {
			console.log(`********************* onDidChangeRuntimeState ${runtimeState}`);
		}));

		this._register(this._languageRuntime.onDidReceiveRuntimeMessage(languageRuntimeMessage => {
			console.log(`********************* onDidReceiveRuntimeMessage ${languageRuntimeMessage.id}`);
		}));
	}

	override dispose(): void {
		super.dispose();
	}
}

/**
 * The usePositronEnvironmentState custom hook.
 * @returns The hook.
 */
export const usePositronEnvironmentState = (services: PositronEnvironmentServices): PositronEnvironmentState => {
	// Hooks.
	const [environmentViewMode, setEnvironmentViewMode] = useState(PositronEnvironmentViewMode.List);
	const [languageRuntimeDescriptors, setLanguageRuntimeDescriptors] = useState<LanguageRuntimeDescriptor[]>([]);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the did start runtime event handler for the language runtime service.
		disposableStore.add(services.languageRuntimeService.onDidStartRuntime(languageRuntime => {
			const languageRuntimeDescriptor = new LanguageRuntimeDescriptor(languageRuntime);
			disposableStore.add(languageRuntimeDescriptor);
			setLanguageRuntimeDescriptors([...languageRuntimeDescriptors, languageRuntimeDescriptor]);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	console.log('------------------------------------------------');
	console.log('The current set of language runtime descriptors:');
	console.log(languageRuntimeDescriptors);
	console.log('------------------------------------------------');

	// Return the Positron environment state.
	return {
		...services,
		environmentViewMode,
		setEnvironmentViewMode
	};
};
