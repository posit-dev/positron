/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';

/**
 * EnvironmentVariableGroup class.
 */
export class EnvironmentVariableGroup implements IEnvironmentVariableGroup {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private readonly _id: string;

	/**
	 * Gets the title.
	 */
	private readonly _title: string;

	/**
	 * Gets or sets a value which indicates whether the environment variable group is expanded.
	 */
	private _expanded: boolean;

	/**
	 * Gets the environment variable items.
	 */
	private readonly _environmentVariableItems: EnvironmentVariableItem[];

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	get id() {
		return this._id;
	}

	/**
	 * Gets the title.
	 */
	get title() {
		return this._title;
	}

	/**
	 * Gets a value which indicates whether the environment variable group is expanded.
	 */
	get expanded() {
		return this._expanded;
	}

	/**
	 * Gets a value which indicates whether the environment variable group is expanded.
	 */
	set expanded(expanded: boolean) {
		this._expanded = expanded;
	}

	/**
	 * Gets the environment variable items.
	 */
	get environmentVariableItems() {
		return this._environmentVariableItems;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param title The title.
	 * @param expanded A value which indicates whether the envrironment variable group is expanded.
	 * @param environmentVariableItems The environment variable items.
	 */
	constructor(
		id: string,
		title: string,
		expanded: boolean,
		environmentVariableItems: EnvironmentVariableItem[]
	) {
		this._id = id;
		this._title = title;
		this._expanded = expanded;
		this._environmentVariableItems = environmentVariableItems;
	}

	//#endregion Constructor

	//#region Public Methods

	//#endregion Public Methods
}
