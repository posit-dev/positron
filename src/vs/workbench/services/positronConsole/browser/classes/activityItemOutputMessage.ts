/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemOutputMessage class.
 */
export class ActivityItemOutputMessage extends ActivityItem {
	//#region Private Properties

	/**
	 * Gets the cached output lines.
	 */
	private readonly _outputLines: readonly ANSIOutputLine[];

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
	 * @param data The data.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly data: Record<string, string>
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Get the output.
		const output = data['text/plain'];

		// If the output is empty, don't render any output lines; otherwise, process the output into
		// output lines.
		this._outputLines = !output ? [] : ANSIOutput.processOutput(output);
	}

	//#endregion Constructor

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): readonly ANSIOutputLine[] {
		// If scrollback size is undefined, return all of the output lines.
		if (this._scrollbackSize === undefined) {
			return this._outputLines;
		}

		// Truncate the output lines.
		return this._outputLines.slice(-this._scrollbackSize);
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return formatOutputLinesForClipboard(this._outputLines, commentPrefix);
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @returns The remaining scrollback size.
	 */
	public override optimizeScrollback(scrollbackSize: number) {
		// If there are fewer output lines than the scrollback size, clear the scrollback size
		// as all of them will be displayed, and return the remaining scrollback size.
		if (this._outputLines.length <= scrollbackSize) {
			this._scrollbackSize = undefined;
			return scrollbackSize - this._outputLines.length;
		}

		// Set the scrollback size and return 0
		this._scrollbackSize = scrollbackSize;
		return 0;
	}

	//#endregion Public Methods
}
