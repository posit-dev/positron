/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RFilePasteProvider } from './rFilePasteProvider.js';

/**
 * Registers document-level providers that enhance R file editing experience.
 * These are VS Code extension API providers, distinct from language intelligence
 * features provided by the Ark kernel via LSP.
 */
export function registerDocumentProviders(context: vscode.ExtensionContext): void {
	// File paste provider for R path conversion
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