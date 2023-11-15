/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { VariableItem } from 'vs/workbench/services/positronVariables/common/classes/variableItem';
import { IVariableGroup } from 'vs/workbench/services/positronVariables/common/interfaces/variableGroup';

/**
 * VariableGroup class.
 */
export class VariableGroup implements IVariableGroup {
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
	 * Gets or sets a value which indicates whether the variable group is expanded.
	 */
	private _expanded: boolean;

	/**
	 * Gets the variable items.
	 */
	private readonly _variableItems: VariableItem[];

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
	 * Gets a value which indicates whether the variable group is expanded.
	 */
	get expanded() {
		return this._expanded;
	}

	/**
	 * Sets a value which indicates whether the variable group is expanded.
	 */
	set expanded(expanded: boolean) {
		this._expanded = expanded;
	}

	/**
	 * Gets the variable items.
	 */
	get variableItems() {
		return this._variableItems;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param title The title.
	 * @param expanded A value which indicates whether the variable group is expanded.
	 * @param variableItems The variable items.
	 */
	constructor(
		id: string,
		title: string,
		expanded: boolean,
		variableItems: VariableItem[]
	) {
		this._id = id;
		this._title = title;
		this._expanded = expanded;
		this._variableItems = variableItems;
	}

	//#endregion Constructor
}
