/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemTrace class.
 */
export class RuntimeItemTrace extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the timestamp.
	 */
	public readonly timestamp = new Date();

	/**
	 * Gets the output lines.
	 */
	public readonly outputLines: readonly ANSIOutputLine[];

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
		text = text.replace('\x1b', 'ESC');
		text = text.replace('\x9B', 'CSI');

		// Process the text directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(text);
	}

	//#endregion Constructor
}
