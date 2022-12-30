/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { generateUuid } from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IListItem, IListItemsProvider } from 'vs/base/common/positronStuff';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { HeaderDataListItem } from 'vs/workbench/contrib/positronEnvironment/browser/classes/headerDataListItem';
import { HeaderValuesListItem } from 'vs/workbench/contrib/positronEnvironment/browser/classes/headerValuesListItem';

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
			this.setEnvironmentDataEntry(new EnvironmentValueEntry(name, new StringEnvironmentValue(date.toTimeString())));
			this.setEnvironmentValueEntry(new EnvironmentValueEntry(name, new StringEnvironmentValue(date.toTimeString())));
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
		this.environmentValueEntries.delete(name);
		this.onDidChangeListItemsEmitter.fire();
	}

	/**
	 * Clears the environment.
	 */
	clearEnvironment(includeHiddenObjects: boolean) {
		this.environmentDataEntries.clear();
		this.environmentValueEntries.clear();
		this.onDidChangeListItemsEmitter.fire();
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

	/**
	 * Sets an environment value entry.
	 * @param environmenentEntry
	 */
	private setEnvironmentValueEntry(environmenentEntry: EnvironmentValueEntry) {
		this.environmentValueEntries.set(environmenentEntry.name, environmenentEntry);
		this.onDidChangeListItemsEmitter.fire();
	}

	//#endregion Private Methods
}
