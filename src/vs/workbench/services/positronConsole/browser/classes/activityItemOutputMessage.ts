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
	readonly outputLines: readonly ANSIOutputLine[];

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
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return formatOutputLinesForClipboard(this.outputLines, commentPrefix);
	}

	//#endregion Public Methods
}
