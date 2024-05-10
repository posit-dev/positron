/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension';
import { NotebookController } from './notebookController';
import { NotebookSessionService } from './notebookSessionService';

/**
 * Manages notebook controllers.
 */
export class NotebookControllerManager implements vscode.Disposable {
	/** Notebook controllers keyed by language runtime ID. */
	public readonly controllers = new Map<string, NotebookController>();

	/**
	 *
	 * @param _notebookSessionService The notebook session service.
	 */
	constructor(private readonly _notebookSessionService: NotebookSessionService) { }

	/**
	 * Create a notebook controller for a runtime.
	 *
	 * @param runtimeMetadata The language runtime metadata for which to create a notebook controller.
	 */
	public createNotebookController(runtimeMetadata: positron.LanguageRuntimeMetadata): void {
		const { runtimeId } = runtimeMetadata;
		if (this.controllers.has(runtimeId)) {
			throw new Error(`Notebook controller already exists for runtime: ${runtimeId}`);
		}
		const controller = new NotebookController(runtimeMetadata, this._notebookSessionService);
		this.controllers.set(runtimeId, controller);
		log.info(`Registered notebook controller for runtime: ${runtimeId}`);
	}

	/**
	 * Update a notebook's affinity for all known controllers.
	 *
	 * Positron automates certain decisions if a notebook only has a single 'preferred' controller.
	 *
	 * @param notebook The notebook whose affinity to update.
	 * @returns Promise that resolves when the notebook's affinity has been updated across all controllers.
	 */
	public async updateNotebookAffinity(notebook: vscode.NotebookDocument): Promise<void> {
		if (notebook.uri.scheme === 'untitled') {
			// If the notebook is untitled, wait for its data to be updated. This works around the fact
			// that `vscode.openNotebookDocument(notebookType, content)` first creates a notebook
			// (triggering `onDidOpenNotebookDocument`), and later updates its content (triggering
			// `onDidChangeNotebookDocument`).
			const event = await new Promise<vscode.NotebookDocumentChangeEvent | undefined>((resolve) => {
				// Apply a short timeout to avoid waiting indefinitely.
				const timeout = setTimeout(() => {
					disposable.dispose();
					resolve(undefined);
				}, 50);

				const disposable = vscode.workspace.onDidChangeNotebookDocument((e) => {
					if (e.notebook === notebook) {
						clearTimeout(timeout);
						disposable.dispose();
						resolve(e);
					}
				});
			});

			if (event) {
				notebook = event.notebook;
			}
		}

		// Detect the notebook's language.
		// First try the notebook metadata.
		const metadata = notebook.metadata?.custom?.metadata;
		const languageId = metadata?.language_info?.name
			?? metadata?.kernelspec?.language
			// Fall back to the first cell's language.
			?? notebook.getCells()?.[0].document.languageId;

		// Get the preferred controller for the language.
		const preferredRuntime = await positron.runtime.getPreferredRuntime(languageId);
		const preferredController = this.controllers.get(preferredRuntime.runtimeId);

		// Set the affinity across all known controllers.
		for (const controller of this.controllers.values()) {
			const affinity = controller === preferredController
				? vscode.NotebookControllerAffinity.Preferred
				: vscode.NotebookControllerAffinity.Default;
			controller.controller.updateNotebookAffinity(notebook, affinity);
			log.debug(`Updated notebook affinity for controller: ${controller.label}, notebook: ${notebook.uri.path}, affinity: ${affinity}`);
		}
	}

	dispose(): void {
		this.controllers.forEach(c => c.dispose());
	}
}
