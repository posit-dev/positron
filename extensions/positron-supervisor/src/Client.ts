/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Simple representation of a client (and its underlying comm) between Positron and the kernel
 */
export class Client {
	/**
	 * Create a new client representation
	 *
	 * @param id The unique ID of the comm/client instance.
	 * @param target The comm/client's target name (also known as its type); can be any
	 * string. Positron-specific comms are listed in its `RuntimeClientType`
	 * enum.
	 */
	constructor(
		public readonly id: string,
		public readonly target: string) {
	}
}
