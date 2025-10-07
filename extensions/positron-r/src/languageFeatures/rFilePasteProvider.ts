/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Document paste edit provider for R files that converts file paths from clipboard.
 * Matches RStudio's formatDesktopPath behavior for files copied from file manager.
 */
export class RFilePasteProvider implements vscode.DocumentPasteEditProvider {

	/**
	 * Provide paste edits for R files when files are detected in clipboard.
	 */
	async provideDocumentPasteEdits(
		document: vscode.TextDocument,
		ranges: readonly vscode.Range[],
		dataTransfer: vscode.DataTransfer,
		context: vscode.DocumentPasteEditContext,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentPasteEdit[] | undefined> {

		// Check if the setting is enabled
		const setting = vscode.workspace.getConfiguration('positron.r').get<boolean>('autoConvertFilePaths');
		if (!setting) {
			return undefined;
		}

		// Check for file URIs in clipboard
		const uriListItem = dataTransfer.get('text/uri-list');
		if (!uriListItem) {
			return undefined;
		}

		const uriList = await uriListItem.asString();
		if (!uriList) {
			return undefined;
		}

		// Extract file URIs
		const fileUris = uriList.split('\n')
			.map(line => line.trim())
			.filter(line => line.startsWith('file://'));

		if (fileUris.length === 0) {
			return undefined;
		}

		// Convert file URIs to file paths
		const filePaths = fileUris.map(uri => {
			// Handle file:/// format and decode URI components
			const cleanUri = uri.replace(/^file:\/\/\//, '');
			return decodeURIComponent(cleanUri);
		});

		// Skip conversion entirely if ANY paths are UNC paths
		// This is safer than RStudio's approach which would corrupt UNC paths
		const hasUncPaths = filePaths.some(path => path.startsWith('\\\\'));
		if (hasUncPaths) {
			return undefined; // Let normal paste behavior handle UNC paths
		}

		// Convert to R format
		const convertedText = filePaths.length === 1
			? this.formatDesktopPath(filePaths[0])
			: this.formatMultipleFiles(filePaths);

		// Return the paste edit
		return [{
			insertText: convertedText,
			title: filePaths.length === 1
				? 'Insert file path'
				: 'Insert file paths as R vector',
			kind: vscode.DocumentDropOrPasteEditKind.Text
		}];
	}

	/**
	 * Formats a single desktop file path for R (matches RStudio's formatDesktopPath).
	 *
	 * @param filePath The file path to format
	 * @returns Formatted path: "C:/path/file.txt"
	 */
	private formatDesktopPath(filePath: string): string {
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
	private formatMultipleFiles(filePaths: string[]): string {
		const formattedPaths = filePaths.map(path => this.formatDesktopPath(path));
		return `c(${formattedPaths.join(', ')})`;
	}
}