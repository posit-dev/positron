/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IVariableOverflow } from 'vs/workbench/services/positronVariables/common/interfaces/variableOverflow';

/**
 * VariableOverflow class.
 */
export class VariableOverflow implements IVariableOverflow {
	//#region Private Properties

	/**
	 * Gets the identifier.
	 */
	private readonly _id: string;

	/**
	 * Gets the indent level.
	 */
	private readonly _indentLevel: number;

	/**
	 * Gets the overflow values.
	 */
	private readonly _overflowValues: number;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	get id() {
		return this._id;
	}

	/**
	 * Gets the indent level.
	 */
	get indentLevel() {
		return this._indentLevel;
	}

	/**
	 * Gets the overflow values.
	 */
	get overflowValues() {
		return this._overflowValues;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param indentLevel The indent level.
	 * @param overflowValues The overflow values.
	 */
	constructor(
		id: string,
		indentLevel: number,
		overflowValues: number,
	) {
		this._id = id;
		this._indentLevel = indentLevel;
		this._overflowValues = overflowValues;
	}

	//#endregion Constructor
}
