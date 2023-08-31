/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'ansi-output';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemPendingInput class.
 */
export class RuntimeItemPendingInput extends RuntimeItem {
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
	 * @param inputPrompt The input prompt.
	 * @param code The banner.
	 */
	constructor(
		id: string,
		readonly inputPrompt: string,
		readonly code: string
	) {
		// Call the base class's constructor.
		super(id);

		// Process the message directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(code);
	}

	//#endregion Constructor
}
