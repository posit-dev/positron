/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { generateUuid } from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IListItem, IListItemsProvider } from 'vs/base/common/positronStuff';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HeaderDataListItem } from 'vs/workbench/contrib/positronEnvironment/browser/classes/headerDataListItem';
import { HeaderValuesListItem } from 'vs/workbench/contrib/positronEnvironment/browser/classes/headerValuesListItem';
import { EnvironmentClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEnvironmentClient';

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
 * EnvironmentValueEntry class.
 */
export class EnvironmentValueEntry implements IListItem {
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

	/**
	 * Gets the ID of the list item.
	 */
	readonly id: string;

	/**
	 * Gets the height of the list item.
	 */
	readonly height = 24;

	/**
	 * Gets the list item element.
	 */
	get element() {
		return (
			<div className='test-item' style={{ marginLeft: 6 }}>
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
		this.id = generateUuid();
		this.name = name;
		this.value = value;
	}

	//#endregion Constructor
}

/**
 * LanguageEnvironment class.
 */
export class LanguageEnvironment extends Disposable implements IListItemsProvider {
	//#region Private Properties

	/**
	 * The environment data entries in the environment store.
	 */
	private environmentDataEntries = new Map<string, EnvironmentValueEntry>();

	/**
	 * The environment value entries in the environment store.
	 */
	private environmentValueEntries = new Map<string, EnvironmentValueEntry>();

	/**
	 * Emitter for the onDidChangeListItems event.
	 */
	private readonly onDidChangeListItemsEmitter = new Emitter<void>();

	/**
	 * The client side of the of the environment instance; used to communicate
	 * with the language runtime.
	 */
	private _client: EnvironmentClientInstance;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the runtime.
	 */
	get runtime() {
		return this._runtime;
	}

	/**
	 * Gets the identifier.
	 */
	get identifier() {
		// TODO@softwarenerd - For the moment, just reuse the language runtime ID.
		return this._runtime.metadata.runtimeId;
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		return this._runtime.metadata.languageName;
	}

	//#endregion Public Properties

	/**
	 *
	 */
	onDidChangeListItems: Event<void> = this.onDidChangeListItemsEmitter.event;

	get listItems() {
		const items: IListItem[] = [];

		if (this.environmentDataEntries.size) {
			items.push(new HeaderDataListItem());
			items.push(...this.environmentDataEntries.values());
		}

		if (this.environmentValueEntries.size) {
			items.push(new HeaderValuesListItem());
			items.push(...this.environmentValueEntries.values());
		}

		return items;
	}

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _runtime The ILanguageRuntime.
	 */
	constructor(private readonly _runtime: ILanguageRuntime) {
		// Initialize Disposable base class.
		super();

		// Initialize the client instance; used to communicate with the language runtime.
		this._client = new EnvironmentClientInstance(this._runtime);

		// Add the handler for the event indicating a new list of environment data entries.
		this._register(this._client.onDidReceiveList(list => {
			// Clear out the existing environment entries since this list
			// completely replaces them.
			this.clearEnvironment(true);

			// Add the new environment entries.
			for (let i = 0; i < list.variables.length; i++) {
				const variable = list.variables[i];
				// TODO: Handle the case where the variable is something
				// other than a String.
				this.setEnvironmentDataEntry(new EnvironmentValueEntry(
					variable.name, new StringEnvironmentValue(variable.value)));
			}
		}));

		this._register(this._client.onDidReceiveError(error => {
			// TODO: Do we want to show this error to the user? Perhaps in the pane or in a toast?
			console.error(error);
		}));


		// Add the did change runtime state event handler.
		this._register(this._runtime.onDidChangeRuntimeState(runtimeState => {
			// console.log(`********************* onDidChangeRuntimeState ${runtimeState}`);
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput => {
			// console.log('********************* onDidReceiveRuntimeMessageOutput');
			// console.log(languageRuntimeMessageOutput);
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessageInput(() => {
			// console.log('********************* onDidReceiveRuntimeMessageInput');
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessageError(languageRuntimeMessageError => {
			// console.log('********************* languageRuntimeMessageError');
			// console.log(languageRuntimeMessageError);
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
			// console.log('********************* onDidReceiveRuntimeMessagePrompt');
			// console.log(languageRuntimeMessagePrompt);
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
			// console.log('********************* onDidReceiveRuntimeMessageState');
			// console.log(languageRuntimeMessageState);
		}));

		this._register(this._runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
			// console.log('********************* onDidReceiveRuntimeMessageEvent');
			// console.log(languageRuntimeMessageEvent);
		}));

		// Add the did complete startup event handler.
		this._register(this._runtime.onDidCompleteStartup(languageRuntimeInfo => {
			// console.log(`********************* onDidCompleteStartup ${this._runtime.metadata.language}`);
		}));
	}

	/**
	 * Dispose method.
	 */
	override dispose(): void {
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
		this.environmentValueEntries.delete(name);
		this.onDidChangeListItemsEmitter.fire();
	}

	/**
	 * Clears the environment.
	 */
	clearEnvironment(_includeHiddenObjects: boolean) {
		this._client.requestClear();
	}

	/**
	 * Refreshes the environment.
	 */
	refreshEnvironment() {
		this._client.requestRefresh();
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Sets an environment data entry.
	 * @param environmenentEntry
	 */
	private setEnvironmentDataEntry(environmenentEntry: EnvironmentValueEntry) {
		this.environmentDataEntries.set(environmenentEntry.name, environmenentEntry);
		this.onDidChangeListItemsEmitter.fire();
	}

	// /**
	//  * Sets an environment value entry.
	//  * @param environmenentEntry
	//  */
	// private setEnvironmentValueEntry(environmenentEntry: EnvironmentValueEntry) {
	// 	this.environmentValueEntries.set(environmenentEntry.name, environmenentEntry);
	// 	this.onDidChangeListItemsEmitter.fire();
	// }

	//#endregion Private Methods
}
