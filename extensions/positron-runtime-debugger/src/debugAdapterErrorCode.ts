/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Error codes unique to this extension's debug adapters.
 *
 * See the `id` property of the {@link https://microsoft.github.io/debug-adapter-protocol/specification#Types_Message Message} type.
 *
 * NOTE: This should be kept in sync with runtime debugger implementations, including:
 * - extensions/positron-python/python_files/posit/positron/debugger.py
 */
export enum DebugAdapterErrorCode {
	/** The language runtime failed to start the debugger. */
	RuntimeFailedToStart = 0,

	/** The language runtime encountered an unexpected error. */
	UnexpectedRuntimeError = 1
}
