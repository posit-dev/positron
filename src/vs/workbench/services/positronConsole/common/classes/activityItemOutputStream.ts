/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'ansi-output';

/**
 * ActivityItemOutputStream class.
 */
export class ActivityItemOutputStream {
	//#region Private Properties

	/**
	 * Gets the ActivityItemOutputStream array.
	 */
	private readonly _activityItemOutputStreams: ActivityItemOutputStream[] = [];

	/**
	 * Gets or sets the ANSIOutput that is processing the ActivityItemOutputStream array.
	 */
	private _ansiOutput: ANSIOutput | undefined;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): ANSIOutputLine[] {
		// Lazily process output from the ActivityItemOutputStream array.
		if (!this._ansiOutput) {
			this._ansiOutput = new ANSIOutput();
			for (const activityItemOutputStream of this._activityItemOutputStreams) {
				if (activityItemOutputStream.text) {
					this._ansiOutput.processOutput(activityItemOutputStream.text);
				}
			}
		}

		// Return the output lines.
		return this._ansiOutput.outputLines;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param text The text.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly text: string
	) {
		this._activityItemOutputStreams.push(this);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemOutputStream to this ActivityItemOutputStream.
	 * @param activityItemOutputStream The ActivityItemOutputStream to add.
	 */
	public addActivityItemOutputStream(activityItemOutputStream: ActivityItemOutputStream) {
		this._activityItemOutputStreams.push(activityItemOutputStream);
		if (this._ansiOutput && activityItemOutputStream.text) {
			this._ansiOutput.processOutput(activityItemOutputStream.text);
		}
	}

	//#endregion Public Methods
}
