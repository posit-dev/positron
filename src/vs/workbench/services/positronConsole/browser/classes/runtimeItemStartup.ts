/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem.js';

/**
 * RuntimeItemStartup class.
 */
export class RuntimeItemStartup extends RuntimeItemStandard {
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
		readonly implementationVersion: string,
		readonly languageVersion: string
	) {
		// Call the base class's constructor.
		super(id, banner);
	}

	//#endregion Constructor
}
