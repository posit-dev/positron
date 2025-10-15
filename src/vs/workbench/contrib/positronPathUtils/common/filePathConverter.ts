/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUNC, toSlashes } from '../../../../base/common/extpath.js';
import { URI } from '../../../../base/common/uri.js';
import { relativePath } from '../../../../base/common/resources.js';

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
}

/**
 * Converts clipboard files to forward-slash, quoted file paths.
 * Uses relative paths when workspace context is available.
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
 * Uses relative path if base URI provided and the file is within that workspace.
 *
 * @param filePath The file path to format
 * @param options Options for path formatting
 * @returns Quoted forward-slash path: "C:/path/file.txt" or "./relative/path.txt"
 */
function formatForwardSlashPath(filePath: string, options?: ConvertClipboardFilesOptions): string {
	if (!filePath) {
		return '';
	}

	let processedPath = filePath;

	// Use relative path if requested and base URI provided (follows RelativePathProvider pattern)
	if (options?.preferRelative && options.baseUri) {
		const fileUri = URI.file(filePath);
		const relativePathResult = relativePath(options.baseUri, fileUri);

		// Only use relative path if it was successfully calculated
		if (relativePathResult) {
			processedPath = relativePathResult;
		}
	}

	// Convert backslashes to forward slashes
	const normalized = toSlashes(processedPath);

	// Escape existing quotes and wrap in double quotes
	const escaped = normalized.replace(/"/g, '\\"');
	return `"${escaped}"`;
}
