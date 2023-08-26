/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ANSIOutput, ANSIOutputLine } from 'ansi-output';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput {
	//#region Private Properties

	/**
	 * The code.
	 */
	private _code: string;

	/**
	 * A value which indicates whether the ActivityItemInput is executing.
	 */
	private _executing = false;

	/**
	 * The code output lines.
	 */
	private _codeOutputLines: ANSIOutputLine[];

	/**
	 * onChanged event emitter.
	 */
	private _onChangedEmitter = new Emitter<void>();

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the code.
	 */
	get code() {
		return this._code;
	}

	/**
	 * Sets the code.
	 * @param code The code.
	 */
	set code(code: string) {
		this._code = code;
		this._codeOutputLines = ANSIOutput.processOutput(this._code);
		this._onChangedEmitter.fire();
	}

	/**
	 * Gets a value which indicates whether the ActivityItemInput is executing.
	 */
	get executing() {
		return this._executing;
	}

	/**
	 * Sets a value which indicates whether the ActivityItemInput is executing.
	 * @param executing A value which indicates whether the ActivityItemInput is executing
	 */
	set executing(executing: boolean) {
		this._executing = executing;
		this._onChangedEmitter.fire();
	}

	/**
	 * Gets the code output lines.
	 */
	get codeOutputLines() {
		return this._codeOutputLines;
	}

	/**
	 * An event that fires when the ActivityItemInput changes.
	 */
	public onChanged = this._onChangedEmitter.event;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param provisional A value which indicates whether this is a provisional ActivityItemInput.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param inputPrompt The input prompt.
	 * @param continuationPrompt The continuation prompt.
	 * @param code The code.
	 */
	constructor(
		readonly provisional: boolean,
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly inputPrompt: string,
		readonly continuationPrompt: string,
		code: string
	) {
		// Process the code into ANSI output lines suitable for rendering.
		this._code = code;
		this._codeOutputLines = ANSIOutput.processOutput(this._code);

		// Non-provisional ActivityItemInputs are executing by default.
		this._executing = !this.provisional;
	}

	//#endregion Constructor
}
