/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

/**
 * Document paste and drop edit provider for R files that converts files on the clipboard or
 * files being shift+dragged+and+dropped into file paths that are usable in R code.
 */
export class RFilePasteAndDropProvider implements vscode.DocumentPasteEditProvider, vscode.DocumentDropEditProvider {

	// Custom kind for R-formatted file paths
	public static readonly kind = vscode.DocumentDropOrPasteEditKind.Text.append('path', 'r');

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

		const edit = await this.getEdit(dataTransfer);
		if (!edit) {
			return undefined;
		}

		return [{
			insertText: edit.insertText,
			title: edit.title,
			kind: RFilePasteAndDropProvider.kind
		}];
	}

	/**
	 * Provide drop edits for R filepaths when files are dropped into the editor.
	 */
	async provideDocumentDropEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		dataTransfer: vscode.DataTransfer,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentDropEdit | undefined> {

		const edit = await this.getEdit(dataTransfer);
		if (!edit) {
			return undefined;
		}

		const dropEdit = new vscode.DocumentDropEdit(edit.insertText);
		dropEdit.title = edit.title;
		dropEdit.kind = RFilePasteAndDropProvider.kind;
		return dropEdit;
	}

	/**
	 * Shared logic to extract and format file paths for both paste and drop operations.
	 */
	private async getEdit(dataTransfer: vscode.DataTransfer): Promise<{ insertText: string; title: string } | undefined> {
		const setting = vscode.workspace.getConfiguration('positron.r').get<boolean>('autoConvertFilePaths');
		if (!setting) {
			return undefined;
		}

		const filePaths = await positron.paths.extractClipboardFilePaths(dataTransfer, {
			preferRelative: true,
			homeUri: vscode.Uri.file(os.homedir())
		});

		if (!filePaths) {
			return undefined;
		}

		// Format for R: single path or R vector syntax
		const insertText = filePaths.length === 1
			? filePaths[0]
			: `c(${filePaths.join(', ')})`;

		const title = filePaths.length === 1
			? vscode.l10n.t('Insert file path')
			: vscode.l10n.t('Insert file paths');

		return { insertText, title };
	}
}

/**
 * Register the R file paste and drop provider for automatic file path conversion.
 */
export function registerRFilePasteAndDropProvider(context: vscode.ExtensionContext): void {
	const rFilePasteAndDropProvider = new RFilePasteAndDropProvider();
	context.subscriptions.push(
		vscode.languages.registerDocumentPasteEditProvider(
			{ language: 'r' },
			rFilePasteAndDropProvider,
			{
				pasteMimeTypes: ['text/uri-list'],
				providedPasteEditKinds: [RFilePasteAndDropProvider.kind]
			}
		),
		vscode.languages.registerDocumentDropEditProvider(
			{ language: 'r' },
			rFilePasteAndDropProvider,
			{
				dropMimeTypes: ['text/uri-list'],
				providedDropEditKinds: [RFilePasteAndDropProvider.kind]
			}
		)
	);
}
