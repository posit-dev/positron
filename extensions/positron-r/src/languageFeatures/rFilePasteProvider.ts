/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Document paste edit provider for R files that converts file paths from clipboard.
 * Uses Positron's paths API for data analysis code integration.
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

		// Use Positron's paths API to extract file paths
		const filePaths = await positron.paths.extractClipboardFilePaths(dataTransfer);
		if (!filePaths) {
			return undefined;
		}

		// Format for R: single path or R vector syntax
		const insertText = filePaths.length === 1
			? filePaths[0] // Already formatted by forwardSlashify in core utility
			: `c(${filePaths.join(', ')})`; // R vector syntax

		// Return the paste edit
		return [{
			insertText,
			title: filePaths.length === 1
				? 'Insert file path for data analysis'
				: 'Insert file paths as R vector',
			kind: vscode.DocumentDropOrPasteEditKind.Text
		}];
	}
}

/**
 * Register the R file paste provider for automatic file path conversion.
 */
export function registerRFilePasteProvider(context: vscode.ExtensionContext): void {
	const rFilePasteProvider = new RFilePasteProvider();
	context.subscriptions.push(
		vscode.languages.registerDocumentPasteEditProvider(
			{ language: 'r' },
			rFilePasteProvider,
			{
				pasteMimeTypes: ['text/uri-list'],
				providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text]
			}
		)
	);
}