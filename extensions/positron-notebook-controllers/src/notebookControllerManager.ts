/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { trace } from './logging';
import { NotebookController } from './notebookController';

/**
 * Manages notebook controllers.
 */
export class NotebookControllerManager implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];

	/** Notebook controllers keyed by languageId. */
	public readonly controllers = new Map<string, NotebookController>();

	/**
	 * Create a notebook controller for a language.
	 *
	 * @param languageId The language ID for which to create a notebook controller.
	 */
	public createNotebookController(languageId: string): void {
		if (!this.controllers.has(languageId)) {
			const controller = new NotebookController(languageId);
			this.controllers.set(languageId, controller);
			this.disposables.push(controller);
			trace(`Registered notebook controller for language: ${languageId}`);
		}
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
		// If the notebook is untitled, wait for its data to be updated. This works around the fact
		// that `vscode.openNotebookDocument(notebookType, content)` first creates a notebook
		// (triggering `onDidOpenNotebookDocument`), and later updates its content (triggering
		// `onDidChangeNotebookDocument`).
		if (notebook.uri.scheme === 'untitled') {
			const event = await nextNotebookDocumentChange(notebook, 50);
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
		const preferredController = languageId && this.controllers.get(languageId);

		// Set the affinity across all known controllers.
		for (const controller of this.controllers.values()) {
			const affinity = controller === preferredController
				? vscode.NotebookControllerAffinity.Preferred
				: vscode.NotebookControllerAffinity.Default;
			controller.controller.updateNotebookAffinity(notebook, affinity);
		}
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

/**
 * Wait for the next change event for a notebook.
 *
 * @param notebook The notebook document.
 * @param timeoutMs Timeout duration in milliseconds.
 * @returns Promise that resolves when the next change event occurs for a notebook,
 * or resolves with undefined if the timeout is reached.
 */
function nextNotebookDocumentChange(
	notebook: vscode.NotebookDocument, timeoutMs: number
): Promise<vscode.NotebookDocumentChangeEvent | undefined> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			disposable.dispose();
			resolve(undefined);
		}, timeoutMs);

		const disposable = vscode.workspace.onDidChangeNotebookDocument((e) => {
			if (e.notebook === notebook) {
				clearTimeout(timeout);
				disposable.dispose();
				resolve(e);
			}
		});
	});
}
