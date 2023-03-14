/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

/**
 * ActivityItemOutputMessage class.
 */
export class ActivityItemOutputMessage {
	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param data The data.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly data: Record<string, string>
	) {
		// Process the data directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(data['text/plain']);
	}

	//#endregion Constructor
}
