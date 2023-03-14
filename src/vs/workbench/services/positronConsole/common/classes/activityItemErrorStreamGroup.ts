/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStream';

/**
 * ActivityItemErrorStreamGroup class.
 */
export class ActivityItemErrorStreamGroup {
	//#region Private Properties

	/**
	 * Gets the ActivityItemErrorStream array.
	 */
	private readonly _activityItemErrorStreams: ActivityItemErrorStream[] = [];

	/**
	 * Gets the ANSIOutput that is handling the output.
	 */
	private readonly _ansiOutput = new ANSIOutput();

	//#endregion Private Properties

	//#region Public Properties

	readonly id = generateUuid();

	readonly parentId: string;

	get outputLines(): ANSIOutputLine[] {
		return this._ansiOutput.outputLines;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param activityItemErrorStream The initial ActivityItemErrorStream.
	 */
	constructor(activityItemErrorStream: ActivityItemErrorStream) {
		this.parentId = activityItemErrorStream.parentId;
		this.addActivityItemErrorStream(activityItemErrorStream);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemErrorStream.
	 * @param activityItemErrorStream The ActivityItemErrorStream to add.
	 */
	addActivityItemErrorStream(activityItemErrorStream: ActivityItemErrorStream) {
		this._activityItemErrorStreams.push(activityItemErrorStream);
		if (activityItemErrorStream.text) {
			this._ansiOutput.processOutput(activityItemErrorStream.text);
		}
	}

	//#endregion Public Methods
}
