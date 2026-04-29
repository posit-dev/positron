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
	//#region Private Properties

	/**
	 * The output lines, processed and ready for rendering. Initialized in the constructor and
	 * mutated by trimScrollback.
	 */
	private _outputLines: readonly ANSIOutputLine[];

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	public get outputLines(): readonly ANSIOutputLine[] {
		return this._outputLines;
	}

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
		this._outputLines = ANSIOutput.processOutput(message);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A number representing the remaining scrollback size.
	 */
	public override trimScrollback(scrollbackSize: number): number {
		// We should never be called with a scrollback size <= 0.
		if (scrollbackSize <= 0) {
			return 0;
		}

		// If no trimming is needed, return the remaining scrollback size.
		if (this._outputLines.length <= scrollbackSize) {
			return scrollbackSize - this._outputLines.length;
		}

		// Otherwise, trim output lines and report the scrollback as fully consumed.
		this._outputLines = this._outputLines.slice(-scrollbackSize);
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
