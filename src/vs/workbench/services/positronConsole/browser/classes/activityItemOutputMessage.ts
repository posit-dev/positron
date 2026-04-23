/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { ILanguageRuntimeMessageOutputData } from '../../../languageRuntime/common/languageRuntimeService.js';

/**
 * ActivityItemOutputMessage class.
 */
export class ActivityItemOutputMessage extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	outputLines: ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param data The data.
	 * @param outputId The optional identifier of the output associated with this activity item.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly data: ILanguageRuntimeMessageOutputData,
		readonly outputId?: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Get the output.
		const output = data['text/plain'];

		// If the output is empty, don't render any output lines; otherwise, process the output into
		// output lines.
		this.outputLines = !output ? [] : ANSIOutput.processOutput(output);
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
		if (this.outputLines.length <= scrollbackSize) {
			return scrollbackSize - this.outputLines.length;
		}

		// Otherwise, trim output lines and report the scrollback as fully consumed.
		this.outputLines = this.outputLines.slice(-scrollbackSize);
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
