/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Document paste edit provider for R files that converts files on the clipboard
 * into file paths that are usable in R code.
 */
export class RFilePasteProvider implements vscode.DocumentPasteEditProvider {

	/**
	 * Provide paste edits for R filepaths when files are detected on clipboard.
	 */
	async provideDocumentPasteEdits(
		document: vscode.TextDocument,
		ranges: readonly vscode.Range[],
		dataTransfer: vscode.DataTransfer,
		context: vscode.DocumentPasteEditContext,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentPasteEdit[] | undefined> {

		const setting = vscode.workspace.getConfiguration('positron.r').get<boolean>('autoConvertFilePaths');
		if (!setting) {
			return undefined;
		}

		// Use Positron's paths API to extract and convert file paths
		const filePaths = await positron.paths.extractClipboardFilePaths(dataTransfer);
		if (!filePaths) {
			return undefined;
		}

		// Format for R: single path or R vector syntax
		const insertText = filePaths.length === 1
			? filePaths[0]
			: `c(${filePaths.join(', ')})`;

		return [{
			insertText,
			title: 'Insert quoted, forward-slash file path(s)',
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
