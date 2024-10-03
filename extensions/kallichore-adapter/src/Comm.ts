/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Simple representation of a comm (communications channel) between the client
 * and the kernel
 */
export class Comm {
	/**
	 * Create a new comm representation
	 *
	 * @param id The unique ID of the comm instance @param target The comm
	 * @param target The comm's target name (also know as its type); can be any
	 * string. Positron-specific comms are listed in its `RuntimeClientType`
	 * enum.
	 */
	constructor(
		public readonly id: string,
		public readonly target: string) {
	}
}
