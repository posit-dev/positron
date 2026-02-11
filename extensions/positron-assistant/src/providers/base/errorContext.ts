/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Context about where an error is being displayed.
 * Used to adjust error messaging and notification behavior based on context.
 */
export interface ErrorContext {
	/** True if error occurs during connection testing */
	isConnectionTest: boolean;
	/** True if error should be displayed in chat pane */
	isChat: boolean;
	/** True if error occurs during startup/registration */
	isStartup: boolean;
	/** Optional request ID for debugging */
	requestId?: string;
}
