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

	public busyState: boolean = false;

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

	public setBusyState(busyState: boolean): void {
		this.busyState = busyState;
		this._onBusyStateChangedEmitter.fire(busyState);
	}
}
