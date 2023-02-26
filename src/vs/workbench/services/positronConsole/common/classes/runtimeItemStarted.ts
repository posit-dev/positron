/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { OutputLine, outputLineSplitter } from 'vs/workbench/services/positronConsole/common/classes/outputLine';

/**
 * RuntimeItemStarted class.
 */
export class RuntimeItemStarted extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	public readonly outputLines: readonly OutputLine[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param banner The banner.
	 */
	constructor(
		id: string,
		banner: string) {
		super(id);
		this.outputLines = outputLineSplitter(banner);
	}

	//#endregion Constructor
}
