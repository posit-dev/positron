/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUNC } from '../../../../base/common/extpath.js';

/**
 * File path conversion utilities for R contexts.
 * Matches RStudio's formatDesktopPath behavior exactly for drive-letter paths,
 * while safely avoiding conversion of UNC paths.
 */

/**
 * Converts clipboard files to R file path format (matches RStudio behavior).
 *
 * @param dataTransfer The clipboard DataTransfer object
 * @returns Formatted R file path string, or null if no conversion should be applied
 */
export function convertClipboardFiles(dataTransfer: DataTransfer): string | null {
	let filePaths: string[] = [];

	// Check for file URI list (primary method)
	const uriList = dataTransfer.getData('text/uri-list');
	if (uriList) {
		const fileUris = uriList.split('\n')
			.filter(line => line.trim().startsWith('file://'));

		// Check for UNC paths BEFORE decoding URIs
		// UNC paths in URIs look like: file://server/share/path (not file:///server/share)
		const hasUncUris = fileUris.some(uri => {
			const trimmed = uri.trim();
			// UNC URIs have the pattern: file://server/share (only 2 slashes after file:)
			return trimmed.match(/^file:\/\/[^\/]+\/[^\/]+/);
		});

		if (hasUncUris) {
			return null; // Skip conversion for UNC paths
		}

		filePaths = fileUris.map(uri => {
			// Handle file:/// format and decode URI components
			const cleanUri = uri.trim().replace(/^file:\/\/\//, '');
			return decodeURIComponent(cleanUri);
		});
	}
	// Note: dataTransfer.files doesn't provide full file paths in browsers for security reasons,
	// so we rely solely on the text/uri-list method which does provide full paths

	if (filePaths.length === 0) {
		return null; // No files detected
	}

	// Skip conversion entirely if ANY paths are UNC paths
	// This is safer than RStudio's approach which would corrupt UNC paths
	const hasUncPaths = filePaths.some(path => isUNC(path));
	if (hasUncPaths) {
		return null; // Let normal paste behavior handle UNC paths
	}

	// Only convert regular drive-letter paths
	if (filePaths.length === 1) {
		return formatDesktopPath(filePaths[0]);
	} else {
		return formatMultipleFiles(filePaths);
	}
}

/**
 * Formats a single desktop file path for R (matches RStudio's formatDesktopPath).
 *
 * @param filePath The file path to format
 * @returns Formatted path: "C:/path/file.txt"
 */
function formatDesktopPath(filePath: string): string {
	if (!filePath) {
		return '';
	}

	// Normalize slashes (\ → /) - matches RStudio's normalizeSlashes
	const normalized = filePath.replace(/\\/g, '/');

	// Escape existing quotes - matches RStudio's quote escaping
	const escaped = normalized.replace(/"/g, '\\"');

	// Wrap in quotes - matches RStudio's behavior
	return `"${escaped}"`;
}

/**
 * Formats multiple desktop file paths as an R vector (matches RStudio's multi-file behavior).
 *
 * @param filePaths Array of file paths to format
 * @returns Formatted R vector: c("C:/path/file1.txt", "C:/path/file2.txt")
 */
function formatMultipleFiles(filePaths: string[]): string {
	const formattedPaths = filePaths.map(formatDesktopPath);
	return `c(${formattedPaths.join(', ')})`;
}