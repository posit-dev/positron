/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';

/**
 * ActivityItemOutputStreamGroup class.
 */
export class ActivityItemOutputStreamGroup {
	//#region Private Properties

	/**
	 * Gets the ActivityItemOutput array.
	 */
	private readonly _activityItemOutputStreams: ActivityItemOutputStream[] = [];

	/**
	 * Gets the ANSIOutput that is handling the ActivityItemOutputGroup array.
	 */
	private readonly _ansiOutput = new ANSIOutput();

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the identifier.
	 */
	readonly id = generateUuid();

	/**
	 * Gets the parent identifier.
	 */
	readonly parentId: string;

	/**
	 * Gets the output lines.
	 */
	get outputLines(): ANSIOutputLine[] {
		return this._ansiOutput.outputLines;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param activityItemOutputStream The initial item.
	 */
	constructor(activityItemOutputStream: ActivityItemOutputStream) {
		this.parentId = activityItemOutputStream.parentId;
		this.addActivityItemOutputStream(activityItemOutputStream);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemOutputStream.
	 * @param activityItemOutputStream The ActivityItemOutputStream to add.
	 */
	addActivityItemOutputStream(activityItemOutputStream: ActivityItemOutputStream) {
		this._activityItemOutputStreams.push(activityItemOutputStream);
		if (activityItemOutputStream.text) {
			this._ansiOutput.processOutput(activityItemOutputStream.text);
		}
	}

	//#endregion Public Methods
}
