/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUNC, toSlashes } from '../../../../base/common/extpath.js';
import { URI } from '../../../../base/common/uri.js';
import { relativePath, isEqualOrParent } from '../../../../base/common/resources.js';

/**
 * A resolved base directory for relative path calculation.
 */
export interface ResolvedBase {
	/** The base URI to make paths relative to */
	uri: URI;
	/** Optional prefix to prepend to relative paths (e.g., '~/' for home) */
	prefix?: string;
}

/**
 * Converts clipboard files to forward-slash, quoted file paths.
 * Optionally makes paths relative to provided base directories.
 *
 * @param uriListData Raw URI list data from clipboard
 * @param bases Base directories to try for relative path calculation, in priority order
 * @returns Array of quoted, forward-slash file paths, or null if no conversion should be applied
 */
export function convertClipboardFiles(
	uriListData: string,
	bases?: ResolvedBase[]
): string[] | null {
	let filePaths: string[] = [];

	if (uriListData) {
		// On Windows, we definitely see \r\n here
		// On macOS, we see \n
		const fileUris = uriListData.split(/\r?\n/)
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

	return filePaths.map(filePath => formatPathForCode(filePath, bases));
}

/**
 * Formats a file path for use in code: forward slashes, optionally relative,
 * wrapped in double quotes with escaped internal quotes.
 *
 * @param filePath The file path to format
 * @param bases Base directories to try for relative path calculation, in priority order
 * @returns Quoted forward-slash path: "C:/path/file.txt", "relative/path.txt", or "~/relative/path.txt"
 */
export function formatPathForCode(filePath: string, bases?: ResolvedBase[]): string {
	if (!filePath) {
		return '';
	}

	let processedPath = filePath;

	// Try each base in order to find a relative path
	if (bases) {
		const fileUri = URI.file(filePath);

		for (const base of bases) {
			const relative = getRelativePathIfInside(fileUri, base.uri);
			if (relative) {
				processedPath = base.prefix ? `${base.prefix}${relative}` : relative;
				break;
			}
		}
	}

	// Convert backslashes to forward slashes
	const normalized = toSlashes(processedPath);

	// Escape existing quotes and wrap in double quotes
	const escaped = normalized.replace(/"/g, '\\"');
	return `"${escaped}"`;
}

/**
 * Returns a relative path from parent to child if child is inside parent, otherwise undefined.
 *
 * @param childUri The file URI to make relative
 * @param parentUri The parent directory URI
 * @returns Relative path string if child is inside parent, undefined otherwise
 */
function getRelativePathIfInside(childUri: URI, parentUri: URI | undefined): string | undefined {
	if (!parentUri) {
		return undefined;
	}

	// Normalize both URIs to ensure consistent formatting
	// Known to be necessary on Windows to avoid issues with drive letter casing
	const normalizedChild = URI.file(childUri.fsPath);
	const normalizedParent = URI.file(parentUri.fsPath);

	// Check if file is inside the parent directory
	if (!isEqualOrParent(normalizedChild, normalizedParent)) {
		return undefined;
	}

	// Get the relative path using the normalized parent URI
	return relativePath(normalizedParent, normalizedChild);
}
