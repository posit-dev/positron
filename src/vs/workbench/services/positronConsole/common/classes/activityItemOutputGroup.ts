/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { ActivityItemOutput } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutput';

/**
 * ActivityItemOutputGroup class.
 */
export class ActivityItemOutputGroup {
	//#region Private Properties

	/**
	 * Gets the ActivityItemOutput array.
	 */
	private readonly _activityItemOutputs: ActivityItemOutput[] = [];

	/**
	 * Gets the ANSIOutput that is handling the ActivityItemOutputGroup array.
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
	 * @param activityItemOutput The initial output activity item.
	 */
	constructor(activityItemOutput: ActivityItemOutput) {
		this.parentId = activityItemOutput.parentId;
		this.addActivityItemOutput(activityItemOutput);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemOutput.
	 * @param activityItemOutput The ActivityItemOutput to add.
	 */
	addActivityItemOutput(activityItemOutput: ActivityItemOutput) {
		this._activityItemOutputs.push(activityItemOutput);
		const output = activityItemOutput.data['text/plain'];
		if (output.length > 0) {
			this._ansiOutput.processOutput(output);
		}
	}

	//#endregion Public Methods
}
