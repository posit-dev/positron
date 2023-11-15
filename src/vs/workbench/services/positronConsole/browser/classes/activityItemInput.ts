/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansiOutput';

/**
 * ActivityItemInputState enumeration.
 */
export const enum ActivityItemInputState {
	Provisional = 'provisional',
	Executing = 'executing',
	Completed = 'completed'
}

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput {
	//#region Private Properties

	/**
	 * The state.
	 */
	private _state: ActivityItemInputState;

	/**
	 * onStateChanged event emitter.
	 */
	private onStateChangedEmitter = new Emitter<void>();

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the state.
	 */
	get state() {
		return this._state;
	}

	/**
	 * Sets the state.
	 * @param state The state to set.
	 */
	set state(state: ActivityItemInputState) {
		if (state !== this._state) {
			this._state = state;
			this.onStateChangedEmitter.fire();
		}
	}

	/**
	 * The code output lines.
	 */
	readonly codeOutputLines: ANSIOutputLine[];

	//#endregion Public Properties

	/**
	 * An event that fires when the state changes.
	 */
	public onStateChanged = this.onStateChangedEmitter.event;

	//#region Constructor

	/**
	 * Constructor.
	 * @param state The initial state.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param inputPrompt The input prompt.
	 * @param continuationPrompt The continuation prompt.
	 * @param code The code.
	 */
	constructor(
		state: ActivityItemInputState,
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly inputPrompt: string,
		readonly continuationPrompt: string,
		readonly code: string
	) {
		this._state = state;
		this.codeOutputLines = ANSIOutput.processOutput(code);
	}

	//#endregion Constructor
}
