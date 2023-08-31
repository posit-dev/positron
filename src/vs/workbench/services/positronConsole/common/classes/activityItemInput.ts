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
	 * A value which indicates whether the ActivityItemInput is executing.
	 */
	private executingValue = false;

	/**
	 * onChanged event emitter.
	 */
	private onChangedEmitter = new Emitter<void>();

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets a value which indicates whether the ActivityItemInput is executing.
	 */
	get executing() {
		return this.executingValue;
	}

	/**
	 * Sets a value which indicates whether the ActivityItemInput is executing.
	 * @param executing A value which indicates whether the ActivityItemInput is executing
	 */
	set executing(executing: boolean) {
		this.executingValue = executing;
		this.onChangedEmitter.fire();
	}

	/**
	 * The code output lines.
	 */
	readonly codeOutputLines: ANSIOutputLine[];

	//#endregion Public Properties

	/**
	 * An event that fires when the ActivityItemInput changes.
	 */
	public onChanged = this.onChangedEmitter.event;

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
		readonly code: string
	) {
		// Process the code into ANSI output lines suitable for rendering.
		this.codeOutputLines = ANSIOutput.processOutput(code);

		// A non-provisional ActivityItemInput is executing by default.
		this.executing = !this.provisional;
	}

	//#endregion Constructor
}
