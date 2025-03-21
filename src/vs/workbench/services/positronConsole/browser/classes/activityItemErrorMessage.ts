/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemErrorMessage class.
 */
export class ActivityItemErrorMessage extends ActivityItem {
	//#region Private Properties

	/**
	 * Gets the message output lines.
	 */
	private _messageOutputLines: ANSIOutputLine[];

	/**
	 * Gets the traceback output lines.
	 */
	private _tracebackOutputLines: ANSIOutputLine[];

	/**
	 * Gets or sets the scrollback size. This is used to truncate the output lines for display.
	 */
	private _scrollbackSize?: number;

	//#endregion Private Properties

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
		this._messageOutputLines = ANSIOutput.processOutput(detailedMessage);
		this._tracebackOutputLines = !traceback.length ?
			[] :
			ANSIOutput.processOutput(traceback.join('\n'));
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	get messageOutputLines(): ANSIOutputLine[] {
		// If scrollback size is undefined, return the message output lines.
		if (this._scrollbackSize === undefined) {
			return this._messageOutputLines;
		}

		// Calculate the scrollback size for the message output lines.
		const scrollbackSize = Math.max(0, this._scrollbackSize - this._tracebackOutputLines.length);

		// If no message output lines will be displayed, return an empty array.
		if (!scrollbackSize) {
			return [];
		}

		// If all of the message output lines should be displayed, return the message output lines.
		if (this._messageOutputLines.length <= scrollbackSize) {
			return this._messageOutputLines;
		}

		// Return the truncated message output lines.
		return this._messageOutputLines.slice(-scrollbackSize);
	}

	/**
	 * Gets the traceback output lines.
	 */
	get tracebackOutputLines(): ANSIOutputLine[] {
		// If scrollback size is undefined, return all of the traceback output lines.
		if (this._scrollbackSize === undefined) {
			return this._tracebackOutputLines;
		}

		// If all of the traceback output lines should be displayed, return all of them.
		if (this._tracebackOutputLines.length <= this._scrollbackSize) {
			return this._tracebackOutputLines;
		}

		// Return the truncated traceback output lines.
		return this._tracebackOutputLines.slice(-this._scrollbackSize);
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return [
			...formatOutputLinesForClipboard(this._messageOutputLines, commentPrefix),
			...formatOutputLinesForClipboard(this._tracebackOutputLines, commentPrefix)
		];
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @returns The remaining scrollback size.
	 */
	public override optimizeScrollback(scrollbackSize: number) {
		// Calculate the total number of output lines.
		const outputLines = this._messageOutputLines.length + this._tracebackOutputLines.length;

		// If there are fewer output lines than the scrollback size, clear the scrollback size
		// as all of them will be displayed, and return the remaining scrollback size.
		if (outputLines <= scrollbackSize) {
			this._scrollbackSize = undefined;
			return scrollbackSize - outputLines;
		}

		// Set the scrollback size and return 0
		this._scrollbackSize = scrollbackSize;
		return 0;
	}

	//#endregion Public Methods
}
