/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A notebook exporter, which can export {@link vscode.NotebookDocument}s to a specific file format.
 */
export interface NotebookExporter {
	/**
	 * A human-readable label for the exporter, shown in the export picker.
	 */
	readonly label: string;

	/**
	 * The language ID that this exporter supports, e.g. `python`. If not provided,
	 * the exporter will be available for all languages.
	 */
	readonly supportedLanguageId?: string;

	/**
	 * The file extension that this exporter exports to, including the prefix `.`, e.g. `.py`.
	 * Also used to determine the icon in the export picker.
	 */
	readonly fileExtension: string;

	/**
	 * Export a notebook.
	 *
	 * The exporter is responsible for saving the notebook if needed, and showing the
	 * exported result in the UI.
	 *
	 * The recommended pattern is not to save the notebook unless it's necessary to perform
	 * the export (e.g. if using a CLI that requires a file path), and to show the exported
	 * result in a new unsaved editor tab if possible.
	 *
	 * @param notebook The notebook to export.
	 * @returns A promise that resolves when the export is complete and the result is visible
	 *  to the user.
	 */
	export(notebook: vscode.NotebookDocument): Promise<unknown>;
}

/**
 * The public API for the Positron Notebook Export extension.
 */
export interface NotebookExportExtension {
	/**
	 * All notebook exporters registered with the extension.
	 */
	readonly exporters: readonly NotebookExporter[];

	/**
	 * Register a {@link NotebookExporter} with the extension.
	 *
	 * Registered exporters are included in the export picker if they support
	 * the active notebook's language.
	 *
	 * @param exporter The notebook exporter to register.
	 * @returns A disposable which unregisters the notebook exporter.
	 */
	registerNotebookExporter(exporter: NotebookExporter): vscode.Disposable;
}
