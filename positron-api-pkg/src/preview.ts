/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Positron URL Preview Functions
 *
 *  This file provides cross-platform URL preview functionality that works in both
 *  Positron and VS Code environments.
 *--------------------------------------------------------------------------------------------*/

import { tryAcquirePositronApi } from './runtime';

/**
 * Opens a URL for preview in either Positron's preview pane or VS Code's external browser.
 *
 * This function automatically detects the runtime environment and uses the appropriate
 * method to display URLs:
 * - In Positron: Uses the built-in preview pane via `positron.window.previewUrl`
 * - In VS Code: Opens the URL in the default external browser via `vscode.env.openExternal`
 *
 * @param url - The URL to open/preview
 * @returns Promise that resolves when the URL has been opened
 *
 * @example
 * ```typescript
 * import { previewUrl } from '@posit-dev/positron/preview';
 *
 * // This will work in both Positron and VS Code
 * await previewUrl('https://example.com');
 * await previewUrl('http://localhost:3000');
 * ```
 */
export async function previewUrl(url: string): Promise<void> {
	const positronApi = tryAcquirePositronApi();
	const vscode = await import('vscode');
	const uri = vscode.Uri.parse(url);

	if (positronApi) {
		// We're in Positron - use the preview pane
		positronApi.window.previewUrl(uri);
	} else {

		// We're in VS Code - open in external browser
		await vscode.env.openExternal(uri);
	}
}
