/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemErrorMessage class.
 */
export class ActivityItemErrorMessage extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	readonly messageOutputLines: ANSIOutputLine[];

	/**
	 * Gets the traceback output lines.
	 */
	readonly tracebackOutputLines: ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param name The name of the error.
	 * @param message The error message.
	 * @param traceback The error traceback.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly name: string,
		readonly message: string,
		readonly traceback: string[]
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Create the detailed message. The name provides additional context about the error;
		// add it in red, if it was supplied.
		const detailedMessage = !name ? message : `\x1b[31m${name}\x1b[0m: ${message}`;

		// Set the message output lines and the traceback output lines.
		this.messageOutputLines = ANSIOutput.processOutput(detailedMessage);
		this.tracebackOutputLines = !traceback.length ?
			[] :
			ANSIOutput.processOutput(traceback.join('\n'));
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return [
			...formatOutputLinesForClipboard(this.messageOutputLines, commentPrefix),
			...formatOutputLinesForClipboard(this.tracebackOutputLines, commentPrefix)
		];
	}

	//#endregion Public Methods
}
