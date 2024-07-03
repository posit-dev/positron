/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/posit-dev/positron/issues/2938

declare module 'vscode' {

	export interface OpenDialogOptions {
		/**
		 * Resolve symlinks to their target paths, defaults to `true`.
		 *
		 * Note: The `resolveSymlinks` option is only available on macOS and will be silently
		 * ignored on other platforms.
		 */
		resolveSymlinks?: boolean;
	}
}
