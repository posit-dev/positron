/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput {
	//#region Public Properties

	/**
	 * Gets the code output lines.
	 */
	readonly codeOutputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param code The code.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly code: string
	) {
		// Process the code directly into ANSI output lines suitable for rendering.
		this.codeOutputLines = ANSIOutput.processOutput(code);
	}

	//#endregion Constructor
}
