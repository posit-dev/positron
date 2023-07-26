/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { Emitter, Event } from 'vs/base/common/event';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput {
	//#region Public Properties

	/**
	 * Gets the code output lines.
	 */
	readonly codeOutputLines: readonly ANSIOutputLine[];

	/**
	 * The current busy state; defaults to true since we receive input items
	 * when they are already in the process of being executed.
	 */
	public busyState: boolean = true;

	/**
	 * An event that fires when the busy state changes; the event value is the
	 * new busy state.
	 */
	public onBusyStateChanged: Event<boolean>;

	//#endregion Public Properties

	private _onBusyStateChangedEmitter: Emitter<boolean> = new Emitter<boolean>();

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param inputPrompt The input prompt.
	 * @param continuationPrompt The continuation prompt.
	 * @param code The code.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly inputPrompt: string,
		readonly continuationPrompt: string,
		readonly code: string
	) {
		// Process the code directly into ANSI output lines suitable for rendering.
		this.codeOutputLines = ANSIOutput.processOutput(code);

		this.onBusyStateChanged = this._onBusyStateChangedEmitter.event;
	}

	//#endregion Constructor

	/**
	 * Sets the busy state.
	 *
	 * @param busyState The new busy state
	 */
	public setBusyState(busyState: boolean): void {
		this.busyState = busyState;
		this._onBusyStateChangedEmitter.fire(busyState);
	}
}
