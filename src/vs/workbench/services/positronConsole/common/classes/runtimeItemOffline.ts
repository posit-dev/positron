/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemOffline class.
 */
export class RuntimeItemOffline extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	public readonly outputLines: readonly ANSIOutputLine[];

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
}
