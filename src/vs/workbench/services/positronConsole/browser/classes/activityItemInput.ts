/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemInputState enumeration.
 */
export const enum ActivityItemInputState {
	Provisional = 'provisional',
	Executing = 'executing',
	Completed = 'completed',
	Cancelled = 'cancelled'
}

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput extends ActivityItem {
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
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param state The initial state.
	 * @param inputPrompt The input prompt.
	 * @param continuationPrompt The continuation prompt.
	 * @param code The code.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		state: ActivityItemInputState,
		readonly inputPrompt: string,
		readonly continuationPrompt: string,
		readonly code: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Initialize.
		this._state = state;
		this.codeOutputLines = ANSIOutput.processOutput(code);
	}

	//#endregion Constructor
}
