/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IListItem, IListItemsProvider } from 'vs/base/common/positronStuff';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * EnvironmentValue interface.
 */
export interface EnvironmentValue {
	/**
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets the display value.
	 */
	readonly displayValue: string;
}

/**
 * StringEnvironmentValue class.
 */
export class StringEnvironmentValue implements EnvironmentValue {
	//#region Public Properties

	/**
	 * Gets the display identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets the display value.
	 */
	readonly displayValue: string;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param value The string value.
	 */
	constructor(value: string) {
		this.identifier = generateUuid();
		this.displayValue = value;
	}

	//#endregion Constructor
}

/**
 * EnvironmentEntry class.
 */
export class EnvironmentEntry implements IListItem {
	//#region Public Properties

	/**
	 * Gets the name of the environment entry.
	 */
	readonly name: string;

	/**
	 * Gets the value of the environment entry.
	 */
	readonly value: EnvironmentValue;

	//#endregion Public Properties

	//#region IListItem

	readonly id = generateUuid();

	readonly height = 24;

	get element() {
		return (
			<div className='test-item'>
				{`${this.name} - ${this.value.displayValue}`}
			</div>
		);
	}

	//#endregion IListItem

	//#region Constructor

	/**
	 * Constructor.
	 * @param name The name of the environment entry.
	 * @param value The value of the environment entry.
	 */
	constructor(name: string, value: EnvironmentValue) {
		this.name = name;
		this.value = value;
	}

	//#endregion Constructor
}

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
 * The Positron environment view mode.
 */
export enum Yack {
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
 * LanguageEnvironment class.
 */
export class LanguageEnvironment extends Disposable implements IListItemsProvider {
	//#region Private Properties

	/**
	 * The environment entries in the environment store.
	 */
	private environmentEntries = new Map<string, EnvironmentEntry>();

	/**
	 * Emitter for the onDidChangeListItems event.
	 */
	private readonly onDidChangeListItemsEmitter = new Emitter<void>();

	/**
	 * Test interval.
	 */
	private testInterval: NodeJS.Timer;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		// TODO@softwarenerd - For the moment, just reuse the language runtime ID.
		return this._languageRuntime.metadata.id;
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		// TODO@softwarenerd - Temporary code because R's metadata returns 'r' for the language and something like
		// 'R: /Library/Frameworks/R.framework/Resources' for the name.
		if (this._languageRuntime.metadata.name.startsWith('R')) {
			return 'R';
		} else {
			return this._languageRuntime.metadata.name;
		}
	}

	//#endregion Public Properties

	/**
	 *
	 */
	onDidChangeListItems: Event<void> = this.onDidChangeListItemsEmitter.event;

	get listItems() {
		return [...this.environmentEntries.values()];
	}

	//#region Constructor & Dispose

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

		this.testInterval = setInterval(() => {
			console.log(`testInterval fired. ${new Date().getTime()}`);
			const date = new Date();
			const name = `variable${date.getTime()}`;
			this.setEnvironmentEntry(new EnvironmentEntry(name, new StringEnvironmentValue(date.toTimeString())));
		}, 1000);
	}

	/**
	 * Dispose method.
	 */
	override dispose(): void {
		// Clear the test interval.
		clearInterval(this.testInterval);

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Deletes an environment entry.
	 * @param name The name of the environment entry.
	 */
	deleteEnvironmentEntry(name: string) {
		this.environmentEntries.delete(name);
		this.onDidChangeListItemsEmitter.fire();
	}

	/**
	 * Clears environment entries.
	 */
	clearEnvironmentEntries(includeHiddenObjects: boolean) {
		this.environmentEntries.clear();
		this.onDidChangeListItemsEmitter.fire();
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Sets an environment entry.
	 * @param environmenentEntry
	 */
	private setEnvironmentEntry(environmenentEntry: EnvironmentEntry) {
		this.environmentEntries.set(environmenentEntry.name, environmenentEntry);
		this.onDidChangeListItemsEmitter.fire();
	}

	//#endregion Private Methods
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
			setLanguageEnvironments(languageEnvironments => [...languageEnvironments, languageEnvironment]);
			disposableStore.add(languageEnvironment);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	useEffect(() => {
	}, [languageEnvironments]);

	useEffect(() => {
		console.log('The current language environmenent changed');
	}, [currentLanguageEnvironment]);

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
