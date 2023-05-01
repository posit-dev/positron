/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

/**
 * ActivityItemErrorStream class.
 */
export class ActivityItemErrorStream {
	//#region Private Properties

	/**
	 * Gets the ActivityItemErrorStream array.
	 */
	private readonly _activityItemErrorStreams: ActivityItemErrorStream[] = [];

	/**
	 * Gets or sets the ANSIOutput that is processing the ActivityItemErrorStream array
	 */
	private _ansiOutput: ANSIOutput | undefined;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): ANSIOutputLine[] {
		// Lazily process output from the the ActivityItemErrorStream array.
		if (!this._ansiOutput) {
			this._ansiOutput = new ANSIOutput();
			for (const activityItemErrorStream of this._activityItemErrorStreams) {
				if (activityItemErrorStream.text) {
					this._ansiOutput.processOutput(activityItemErrorStream.text);
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
		this._activityItemErrorStreams.push(this);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemErrorStream.
	 * @param activityItemErrorStream The ActivityItemErrorStream to add.
	 */
	addActivityItemErrorStream(activityItemErrorStream: ActivityItemErrorStream) {
		this._activityItemErrorStreams.push(activityItemErrorStream);
		if (this._ansiOutput && activityItemErrorStream.text) {
			this._ansiOutput.processOutput(activityItemErrorStream.text);
		}
	}

	//#endregion Public Methods
}
