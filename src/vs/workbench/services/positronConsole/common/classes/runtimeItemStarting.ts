/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';

/**
 * RuntimeItemStarting class.
 */
export class RuntimeItemStarting extends RuntimeItem {
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
	 * @param banner The banner.
	 */
	constructor(id: string, banner: string) {
		super(id);
		this.outputLines = ANSIOutput.processOutput(banner);
	}

	//#endregion Constructor
}
