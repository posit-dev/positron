/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

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
		// Get the output.
		const output = data['text/plain'];

		// If the output is empty, don't render any output lines; otherwise, process the output into
		// output lines.
		this.outputLines = !output ? [] : ANSIOutput.processOutput(output);
	}

	//#endregion Constructor
}
