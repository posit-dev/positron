/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUNC, toSlashes } from '../../../../base/common/extpath.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Utilities for getting file paths when files (yes, actual files, not paths)
 * are on the clipboard
 */

/**
 * Converts clipboard files to forward-slash, quoted file paths.
 *
 * @param dataTransfer The clipboard DataTransfer object
 * @returns Array of forward-slash file paths, or null if no conversion should be applied
 */
export function convertClipboardFiles(dataTransfer: DataTransfer): string[] | null {
	let filePaths: string[] = [];

	// Check for file URI list from clipboard
	const uriList = dataTransfer.getData('text/uri-list');
	if (uriList) {
		// On Windows, we definitely see \r\n here
		const fileUris = uriList.split(/\r?\n/)
			.filter(line => line.trim().startsWith('file://'));

		filePaths = fileUris.map(uri => {
			// Convert file URIs (file:///C:/path or file://server/share) to filesystem paths
			return URI.parse(uri.trim()).fsPath;
		});
	}

	if (filePaths.length === 0) {
		return null;
	}

	// Err on the side of caution and skip conversion entirely if ANY paths are
	// UNC paths
	const hasUncPaths = filePaths.some(path => isUNC(path));
	if (hasUncPaths) {
		return null;
	}

	return filePaths.map(formatForwardSlashPath);
}

/**
 * Formats a file path to forward-slash format with proper quoting.
 *
 * @param filePath The file path to format
 * @returns Forward-slash path: "C:/path/file.txt"
 */
function formatForwardSlashPath(filePath: string): string {
	if (!filePath) {
		return '';
	}

	// Convert backslashes to forward slashes
	const normalized = toSlashes(filePath);

	// Escape existing quotes
	const escaped = normalized.replace(/"/g, '\\"');

	// Wrap in quotes for safe usage
	return `"${escaped}"`;
}
