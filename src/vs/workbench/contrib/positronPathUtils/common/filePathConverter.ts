/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUNC, toSlashes } from '../../../../base/common/extpath.js';
import { URI } from '../../../../base/common/uri.js';
import { relativePath, isEqualOrParent } from '../../../../base/common/resources.js';

/**
 * Options for clipboard file conversion
 */
export interface ConvertClipboardFilesOptions {
	/**
	 * Whether to prefer relative paths when baseUri is available (typically the workspace folder).
	 */
	preferRelative?: boolean;

	/**
	 * Base URI for relative path calculation
	 */
	baseUri?: URI;

	/**
	 * User home directory URI for home-relative path calculation
	 */
	homeUri?: URI;
}

/**
 * Converts clipboard files to forward-slash, quoted file paths.
 * Optionally, returns relative paths.
 *
 * @param uriListData Raw URI list data from clipboard
 * @param options Options for path conversion
 * @returns Array of quoted, forward-slash file paths, or null if no conversion should be applied
 */
export function convertClipboardFiles(
	uriListData: string,
	options?: ConvertClipboardFilesOptions
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

	return filePaths.map(filePath => formatForwardSlashPath(filePath, options));
}

/**
 * Formats a file path to forward-slash format with double quotes.
 * Uses relative path if requested and possible.
 * Priority: workspace-relative > home-relative > absolute
 *
 * @param filePath The file path to format
 * @param options Options for path formatting
 * @returns Quoted forward-slash path: "C:/path/file.txt", "relative/path.txt", or "~/relative/path.txt"
 */
function formatForwardSlashPath(filePath: string, options?: ConvertClipboardFilesOptions): string {
	if (!filePath) {
		return '';
	}

	let processedPath = filePath;

	// If requested and possible, make a relative path
	if (options?.preferRelative) {
		const fileUri = URI.file(filePath);

		// Try workspace-relative first
		const workspaceRelative = getRelativePathIfInside(fileUri, options.baseUri);
		if (workspaceRelative) {
			processedPath = workspaceRelative;
		} else {
			// If workspace-relative failed, try home-relative
			const homeRelative = getRelativePathIfInside(fileUri, options.homeUri);
			if (homeRelative) {
				processedPath = `~/${homeRelative}`;
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
