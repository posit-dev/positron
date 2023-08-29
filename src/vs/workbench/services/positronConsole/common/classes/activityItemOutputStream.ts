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
	private readonly activityItemOutputStreams: ActivityItemOutputStream[] = [];

	/**
	 * Gets or sets the ANSIOutput that is processing the ActivityItemOutputStream array.
	 */
	private ansiOutput: ANSIOutput | undefined;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): ANSIOutputLine[] {
		// Lazily process output from the ActivityItemOutputStream array.
		if (!this.ansiOutput) {
			this.ansiOutput = new ANSIOutput();
			for (const activityItemOutputStream of this.activityItemOutputStreams) {
				if (activityItemOutputStream.text) {
					this.ansiOutput.processOutput(activityItemOutputStream.text);
				}
			}
		}

		// Return the output lines.
		return this.ansiOutput.outputLines;
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
		this.activityItemOutputStreams.push(this);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemOutputStream to this ActivityItemOutputStream.
	 * @param activityItemOutputStream The ActivityItemOutputStream to add.
	 */
	public addActivityItemOutputStream(activityItemOutputStream: ActivityItemOutputStream) {
		this.activityItemOutputStreams.push(activityItemOutputStream);
		if (this.ansiOutput && activityItemOutputStream.text) {
			this.ansiOutput.processOutput(activityItemOutputStream.text);
		}
	}

	//#endregion Public Methods
}
