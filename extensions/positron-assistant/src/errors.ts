/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * An error thrown by the assistant that can optionally be displayed to the user.
 * Use this error when you need to control whether the error is shown in a message box.
 */
export class AssistantError extends Error {
	constructor(message: string, public readonly display: boolean = true) {
		super(message);
	}
}
