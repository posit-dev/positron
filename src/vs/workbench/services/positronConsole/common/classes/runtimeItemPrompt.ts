/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemPrompt class.
 */
export class RuntimeItemPrompt extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	answered = false;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param prompt The prompt.
	 * @param password A value which indicates whether this is a password prompt.
	 */
	constructor(
		id: string,
		readonly parentId: string,
		readonly prompt: string,
		readonly password: boolean
	) {
		// Call the base class's constructor.
		super(id);

		// Process the prompt directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(prompt);
	}

	//#endregion Constructor
}
