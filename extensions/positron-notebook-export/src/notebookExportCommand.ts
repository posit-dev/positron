/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NotebookExportExtension } from './positron-notebook-export.js';
import { NotebookCommand } from './util/command.js';
import { getNotebookLanguage } from './util/notebook.js';

/**
 * Command to export a notebook to another file format.
 *
 * See {@link NotebookExportExtension} for more details about how this feature works.
 */
export class NotebookExportCommand extends NotebookCommand {
	// Using `positronNotebook` prefix (matching other Positron notebook commands)
	// even though this command is compatible with Code OSS notebooks,
	// to gaurd against a conflict if upstream eventually use `notebook.export`.
	static ID = 'positronNotebook.export';

	constructor(
		private readonly _api: NotebookExportExtension,
		private readonly _log: vscode.LogOutputChannel,
	) {
		super(NotebookExportCommand.ID);
	}

	async runWithNotebook(notebook: vscode.NotebookDocument | undefined): Promise<void> {
		if (!notebook) {
			vscode.window.showInformationMessage(
				vscode.l10n.t('No active notebook to export.')
			);
			return;
		}

		// Create quick pick items for each exporter that can export this notebook.
		const notebookLanguage = getNotebookLanguage(notebook);
		const items: NotebookExporterQuickPickItem[] = [];
		for (const exporter of this._api.exporters) {
			// Skip this exporter if:
			// - It specifies a supported language, and
			// - The notebook has a language, and
			// - The exporter's supported language does not match the notebook's language.
			if (exporter.supportedLanguageId &&
				notebookLanguage &&
				exporter.supportedLanguageId !== notebookLanguage) {
				this._log.debug(
					`Skipping exporter ${exporter.label} ` +
					`for notebook ${notebook.uri.toString()} ` +
					`due to unsupported language. ` +
					`Exporter supports ${exporter.supportedLanguageId ?? 'any'}, ` +
					`notebook language is ${notebookLanguage ?? 'unknown'}.`
				);
				continue;
			}

			items.push({
				label: exporter.label,
				description: `(${exporter.fileExtension})`,
				// By setting the icon to File and resourceUri ending with a file extension,
				// the file extension's primary icon will be used. Includes custom file
				// extensions & icons like Quarto.
				iconPath: vscode.ThemeIcon.File,
				resourceUri: vscode.Uri.file(exporter.fileExtension),
				export: async () => {
					await exporter.export(notebook);
				}
			});
		}

		// Display items in alphabetical order by label.
		items.sort((a, b) => a.label.localeCompare(b.label));

		// Wait for the user to choose an exporter.
		const item = await vscode.window.showQuickPick(items);

		// Export the notebook.
		await item?.export();
	}
}

interface NotebookExporterQuickPickItem extends vscode.QuickPickItem {
	export: () => Promise<void>;
}
