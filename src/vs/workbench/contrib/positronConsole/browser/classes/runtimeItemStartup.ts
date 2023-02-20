/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItem';
import { Line, lineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';

/**
 * RuntimeItemStartup class.
 */
export class RuntimeItemStartup extends RuntimeItem {
	//#region Public Properties

	/**
	 * Gets the lines.
	 */
	public readonly lines: readonly Line[];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param banner The banner.
	 * @param implementationVersion The implementation version.
	 * @param languageVersion The language version.
	 */
	constructor(
		id: string,
		banner: string,
		public readonly implementationVersion: string,
		public readonly languageVersion: string) {
		super(id);
		this.lines = lineSplitter(banner);
	}

	//#endregion Constructor
}
