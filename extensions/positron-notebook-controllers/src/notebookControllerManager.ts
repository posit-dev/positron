/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { log } from './extension';
import { DidEndExecutionEvent, DidStartExecutionEvent, NotebookController } from './notebookController';
import { NotebookSessionService } from './notebookSessionService';

/**
 * Manages notebook controllers.
 */
export class NotebookControllerManager implements vscode.Disposable {
	/** Notebook controllers keyed by language runtime ID. */
	public readonly controllers = new Map<string, NotebookController>();

	private readonly _disposables = new Array<vscode.Disposable>();

	private readonly _onDidStartExecution = new vscode.EventEmitter<DidStartExecutionEvent>();
	private readonly _onDidEndExecution = new vscode.EventEmitter<DidEndExecutionEvent>();

	/** An event that fires when a notebook execution starts. */
	public readonly onDidStartExecution = this._onDidStartExecution.event;

	/** An event that fires when a notebook execution ends. */
	public readonly onDidEndExecution = this._onDidEndExecution.event;

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

		this._disposables.push(
			controller,

			// Forward the start execution event.
			controller.onDidStartExecution((e) => {
				this._onDidStartExecution.fire(e);
			}),

			// Forward the end execution event.
			controller.onDidEndExecution((e) => {
				this._onDidEndExecution.fire(e);
			})
		);

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
		const cells = notebook.getCells();
		if (cells.length === 1 && cells[0].document.getText() === '') {
			// If its an empty notebook (i.e. it has a single empty cell), wait for its data to be
			// updated. This works around the fact that `vscode.openNotebookDocument(notebookType, content)`
			// first creates a notebook (triggering `onDidOpenNotebookDocument`), and later updates
			// its content (triggering `onDidChangeNotebookDocument`).
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
		let languageId = metadata?.language_info?.name
			?? metadata?.kernelspec?.language;

		// Fall back to the first cell's language, if available.
		if (!languageId) {
			const cells = notebook.getCells();
			if (cells && cells.length > 0) {
				languageId = cells[0].document.languageId;
			} else {
				log.debug(`Notebook has no cells, can't determine language: ${notebook.uri.path}`);
				return;
			}
		}

		// Get the preferred controller for the language.
		let preferredRuntime: positron.LanguageRuntimeMetadata;
		try {
			preferredRuntime = await positron.runtime.getPreferredRuntime(languageId);
		} catch (ex) {
			// It may error if there are no registered runtimes for the language, so log and return.
			log.debug(`Failed to get preferred runtime for language: ${languageId}`, ex);
			return;
		}
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
		this._disposables.forEach(d => d.dispose());
	}
}
