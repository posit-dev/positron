/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { RuntimeItem } from './runtimeItem.js';

/**
 * RuntimeItemStandard class.
 */
export class RuntimeItemStandard extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	outputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param message The message.
	 */
	constructor(id: string, message: string) {
		// Call the base class's constructor.
		super(id);

		// Process the message directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(message);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A number representing the remaining scrollback size.
	 */
	public override trimScrollback(scrollbackSize: number): number {
		// We should never be called with a scrollback size of 0.
		if (scrollbackSize <= 0) {
			// Defensive: if this happens, trim all lines and report the scrollback as fully consumed.
			console.warn(`RuntimeItemStandard.trimScrollback called with non-positive scrollbackSize ${scrollbackSize}; trimming all lines.`);
			this.outputLines = [];
			return 0;
		}

		// If our lines fit in the remaining scrollback budget, keep them all and return what's
		// left of the budget.
		if (this.outputLines.length <= scrollbackSize) {
			return scrollbackSize - this.outputLines.length;
		}

		// Otherwise, trim to the tail of most-recent lines that fit.
		this.outputLines = this.outputLines.slice(-scrollbackSize);

		// Report the scrollback as fully consumed.
		return 0;
	}

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return formatOutputLinesForClipboard(this.outputLines, commentPrefix);
	}

	//#endregion Public Methods
}
