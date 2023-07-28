/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'ansi-output';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemTrace class.
 */
export class RuntimeItemTrace extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the timestamp.
	 */
	readonly timestamp = new Date();

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param text The text.
	 */
	constructor(id: string, text: string) {
		// Call the base class's constructor.
		super(id);

		// Replace ESC and CSI with text so ANSI escape sequences are not regognized.
		text = text.replaceAll('\x1b', 'ESC');
		text = text.replaceAll('\x9B', 'CSI');

		// Process the text directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(text);
	}

	//#endregion Constructor
}
