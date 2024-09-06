/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';
import { NotebookSessionService } from './notebookSessionService';
import { JUPYTER_NOTEBOOK_TYPE } from './constants';
import { log } from './extension';
import { ResourceMap } from './map';

/** The type of a Jupyter notebook cell output. */
enum NotebookCellOutputType {
	/** One of possibly many outputs related to an execution. */
	DisplayData = 'display_data',

	/** The result of an execution. */
	ExecuteResult = 'execute_result',
}

/**
 * Wraps a vscode.NotebookController for a specific language, and manages a notebook runtime session
 * for each vscode.NotebookDocument that uses this controller.
 */
export class NotebookController implements vscode.Disposable {

	private readonly _disposables: vscode.Disposable[] = [];

	/** A map of pending cell executions, keyed by notebook URI. */
	private readonly _pendingCellExecutionsByNotebookUri = new ResourceMap<Promise<void>>();

	/** The wrapped VSCode notebook controller. */
	public readonly controller: vscode.NotebookController;

	/** Incremented for each cell we create to give it a unique ID. */
	private static _CELL_COUNTER = 0;

	/**
	 * @param _runtimeMetadata The metadata of the language runtime for which this controller is responsible.
	 * @param _notebookSessionService The notebook session service.
	 */
	constructor(
		private readonly _runtimeMetadata: positron.LanguageRuntimeMetadata,
		private readonly _notebookSessionService: NotebookSessionService,
	) {
		// Create a VSCode notebook controller for this language.
		this.controller = vscode.notebooks.createNotebookController(
			_runtimeMetadata.runtimeId,
			// The 'jupyter-notebook' notebook type is contributed via the built-in extension
			// extensions/ipynb. Registering our notebook controllers with the same type ensures
			// that they show up in the notebook UI's kernel picker for .ipynb files.
			JUPYTER_NOTEBOOK_TYPE,
			// Display name in the notebook UI's kernel picker.
			this.label,
		);
		this.controller.description = _runtimeMetadata.runtimePath;
		this.controller.supportsExecutionOrder = true;
		this.controller.executeHandler = this.executeCells.bind(this);

		// We intentionally don't set this.controller.supportedLanguages. If we restrict it, when a
		// user first runs a cell in a new notebook with no selected controller, and they select a
		// controller from the quickpick for a language that differs from the cell, the cell will
		// not be executed.

		this._disposables.push(this.controller);

		this._disposables.push(this.controller.onDidChangeSelectedNotebooks(async (e) => {
			log.debug(`Notebook ${e.notebook.uri}, controller ${this.label}, selected ${e.selected}`);

			// Has this controller been selected for a notebook?
			if (e.selected) {
				// Note that this is also reached when a notebook is opened, if this controller was
				// already selected.

				await Promise.all([
					updateNotebookLanguage(e.notebook, _runtimeMetadata.languageId),
					this.startRuntimeSession(e.notebook),
				]);
			} else {
				await this._notebookSessionService.shutdownRuntimeSession(e.notebook.uri);
			}
		}));
	}

	/** The human-readable label of the controller. */
	public get label(): string {
		return this._runtimeMetadata.runtimeName;
	}

	/**
	 * Start a runtime session for a notebook.
	 *
	 * @param notebook The notebook to start a runtime for.
	 * @returns Promise that resolves when the runtime has started.
	 */
	private async startRuntimeSession(notebook: vscode.NotebookDocument): Promise<positron.LanguageRuntimeSession> {
		try {
			return await this._notebookSessionService.startRuntimeSession(notebook.uri, this._runtimeMetadata.runtimeId);
		} catch (err) {
			const retry = vscode.l10n.t('Retry');
			const selection = await vscode.window.showErrorMessage(
				vscode.l10n.t(
					'Starting {0} interpreter for "{1}" failed. Reason: {2}',
					this.label,
					notebook.uri.path,
					err
				),
				retry,
			);
			if (selection === retry) {
				return vscode.window.withProgress(this.startProgressOptions(notebook), () => this.startRuntimeSession(notebook));
			}

			throw err;
		}
	}

	/**
	 * Notebook controller execute handler.
	 *
	 * @param cells Cells to execute.
	 * @param notebook Notebook containing the cells.
	 * @param _controller Notebook controller.
	 * @returns Promise that resolves when the language has been set.
	 */
	private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, _controller: vscode.NotebookController) {
		// Queue all cells for execution; catch and log any execution errors.
		await Promise.all(cells.map(cell => this.queueCellExecution(cell, notebook)))
			.catch(err => log.debug(`Error executing cell: ${err}`));
	}

	/**
	 * Execute a notebook cell.
	 *
	 * @param cell Cell to execute.
	 * @returns Promise that resolves when the runtime has finished executing the cell.
	 */
	private queueCellExecution(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
		// Get the pending execution for this notebook, if one exists.
		const pendingExecution = this._pendingCellExecutionsByNotebookUri.get(cell.notebook.uri);

		// Chain this execution after the pending one.
		const currentExecution = Promise.resolve(pendingExecution)
			.then(() => this.executeCell(cell, notebook))
			.finally(() => {
				// If this was the last execution in the chain, remove it from the map,
				// starting a new chain.
				if (this._pendingCellExecutionsByNotebookUri.get(cell.notebook.uri) === currentExecution) {
					this._pendingCellExecutionsByNotebookUri.delete(cell.notebook.uri);
				}
			});

		// Update the pending execution for this notebook.
		this._pendingCellExecutionsByNotebookUri.set(cell.notebook.uri, currentExecution);

		return currentExecution;
	}

	private async executeCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
		if (cell.document.languageId === 'raw') {
			// Don't try to execute raw cells; they're often used to define metadata e.g in Quarto notebooks.
			return;
		}

		// Get the notebook's session.
		let session = this._notebookSessionService.getNotebookSession(notebook.uri);

		// No session has been started for this notebook, start one.
		if (!session) {
			session = await vscode.window.withProgress(this.startProgressOptions(notebook), () => this.startRuntimeSession(notebook));
		}

		// Create a cell execution.
		const currentExecution = this.controller.createNotebookCellExecution(cell);

		// If the cell's stop button is pressed, interrupt the runtime.
		currentExecution.token.onCancellationRequested(session.interrupt.bind(session));

		// Start the execution timer.
		currentExecution.start(Date.now());

		// Clear any existing outputs.
		currentExecution.clearOutput();

		const cellId = `positron-notebook-cell-${NotebookController._CELL_COUNTER++}`;

		let success: boolean;
		try {
			await executeCode({
				session,
				code: cell.document.getText(),
				id: cellId,
				mode: positron.RuntimeCodeExecutionMode.Interactive,
				errorBehavior: positron.RuntimeErrorBehavior.Stop,
				callback: message => this.handleMessageForCellExecution(message, currentExecution),
			});
			success = true;
		} catch (error) {
			// No need to log since the error message will be displayed in the cell output.
			success = false;
		}

		currentExecution.end(success, Date.now());
	}

	private async handleMessageForCellExecution(
		message: positron.LanguageRuntimeMessage,
		currentExecution: vscode.NotebookCellExecution,
	): Promise<void> {
		// Outputs to append to the cell, if any.
		let cellOutput: vscode.NotebookCellOutput | undefined;

		// Handle the message, and store any resulting state.
		switch (message.type) {
			case positron.LanguageRuntimeMessageType.Input:
				currentExecution.executionOrder = (message as positron.LanguageRuntimeInput).execution_count;
				break;
			case positron.LanguageRuntimeMessageType.Output:
				cellOutput = handleRuntimeMessageOutput(
					(message as positron.LanguageRuntimeOutput),
					NotebookCellOutputType.DisplayData
				);
				break;
			case positron.LanguageRuntimeMessageType.Result:
				cellOutput = handleRuntimeMessageOutput(
					(message as positron.LanguageRuntimeResult),
					NotebookCellOutputType.ExecuteResult
				);
				break;
			case positron.LanguageRuntimeMessageType.Stream:
				cellOutput = handleRuntimeMessageStream(message as positron.LanguageRuntimeStream);
				break;
			case positron.LanguageRuntimeMessageType.Error:
				cellOutput = handleRuntimeMessageError(message as positron.LanguageRuntimeError);
				break;
		}

		// Append any resulting outputs to the cell execution.
		if (cellOutput) {
			currentExecution.appendOutput(cellOutput);
		}
	}

	/** Get the progress options for starting a runtime.  */
	private startProgressOptions(notebook: vscode.NotebookDocument): vscode.ProgressOptions {
		return {
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t("Starting {0} interpreter for '{1}'", this.label, notebook.uri.path),
		};
	}

	public async dispose() {
		this._disposables.forEach(d => d.dispose());
	}
}

function executeCode(
	options: {
		session: positron.LanguageRuntimeSession;
		code: string;
		id: string;
		mode: positron.RuntimeCodeExecutionMode;
		errorBehavior: positron.RuntimeErrorBehavior;
		callback: (message: positron.LanguageRuntimeMessage) => Promise<unknown>;
	}
) {
	return new Promise<void>((resolve, reject) => {
		// Create a promise tracking the current message for the cell. Each execution may
		// receive multiple messages, which we want to handle in sequence.
		let currentMessagePromise = Promise.resolve();

		const handler = options.session.onDidReceiveRuntimeMessage(async message => {
			// Only handle replies to this execution.
			if (message.parent_id !== options.id) {
				return;
			}

			// Chain the message promise, so that messages are processed in sequence.
			currentMessagePromise = currentMessagePromise.then(async () => {
				await options.callback(message);

				// Handle the message.
				if (message.type === positron.LanguageRuntimeMessageType.Error) {
					const error = message as positron.LanguageRuntimeError;
					throw error;
				} else if (message.type === positron.LanguageRuntimeMessageType.State) {
					const state = message as positron.LanguageRuntimeState;
					if (state.state === positron.RuntimeOnlineState.Idle) {
						handler.dispose();
						resolve();
					}
				}
			}).catch(error => {
				handler.dispose();
				reject(error);
				throw error;
			});
		});

		// Execute the cell.
		try {
			options.session.execute(
				options.code,
				options.id,
				options.mode,
				options.errorBehavior,
			);
		} catch (error) {
			handler.dispose();
			reject(error);
		}
	});
}

/**
 * Set the language for a notebook.
 *
 * @param notebook Notebook whose language to set.
 * @param languageId The VSCode-compatible language ID compatible.
 * @returns Promise that resolves when the language has been set.
 */
async function updateNotebookLanguage(notebook: vscode.NotebookDocument, languageId: string): Promise<void> {
	// Set the language in the notebook's metadata.
	// This follows the approach from the vscode-jupyter extension.
	if (notebook.metadata?.custom?.metadata?.language_info?.name !== languageId) {
		const edit = new vscode.WorkspaceEdit();
		edit.set(notebook.uri, [
			vscode.NotebookEdit.updateNotebookMetadata({
				...notebook.metadata,
				custom: {
					...notebook.metadata.custom ?? {},
					metadata: {
						...(notebook.metadata.custom?.metadata ?? {}),
						language_info: {
							name: languageId
						}
					}
				}
			})]);
		await vscode.workspace.applyEdit(edit);
	}

	// Set the language in each of the notebook's cells.
	await Promise.all(notebook.getCells()
		.filter(cell => cell.kind === vscode.NotebookCellKind.Code
			&& cell.document.languageId !== languageId
			// Don't change raw cells; they're often used to define metadata e.g in Quarto notebooks.
			&& cell.document.languageId !== 'raw')
		.map(cell => vscode.languages.setTextDocumentLanguage(cell.document, languageId))
	);
}


/**
 * Handle a LanguageRuntimeOutput message.
 *
 * @param message Message to handle.
 * @param outputType Type of the output.
 * @returns Resulting cell output items.
 */
function handleRuntimeMessageOutput(
	message: positron.LanguageRuntimeOutput,
	outputType: NotebookCellOutputType,
): vscode.NotebookCellOutput {
	const cellOutputItems: vscode.NotebookCellOutputItem[] = [];
	for (const [mimeType, data] of Object.entries(message.data)) {
		switch (mimeType) {
			case 'image/png':
			case 'image/jpeg':
				cellOutputItems.push(new vscode.NotebookCellOutputItem(Buffer.from(data, 'base64'), mimeType));
				break;
			// This list is a subset of src/vs/workbench/contrib/notebook/browser/view/cellParts/cellOutput.JUPYTER_RENDERER_MIMETYPES
			case 'application/geo+json':
			case 'application/vdom.v1+json':
			case 'application/vnd.dataresource+json':
			case 'application/vnd.jupyter.widget-view+json':
			case 'application/vnd.plotly.v1+json':
			case 'application/vnd.r.htmlwidget':
			case 'application/vnd.vega.v2+json':
			case 'application/vnd.vega.v3+json':
			case 'application/vnd.vega.v4+json':
			case 'application/vnd.vega.v5+json':
			case 'application/vnd.vegalite.v1+json':
			case 'application/vnd.vegalite.v2+json':
			case 'application/vnd.vegalite.v3+json':
			case 'application/vnd.vegalite.v4+json':
			case 'application/x-nteract-model-debug+json':
				// The JSON cell output item will be rendered using the appropriate notebook renderer.
				cellOutputItems.push(vscode.NotebookCellOutputItem.json(data, mimeType));
				break;
			default:
				cellOutputItems.push(vscode.NotebookCellOutputItem.text(data, mimeType));
		}
	}
	return new vscode.NotebookCellOutput(cellOutputItems, { outputType });
}

/**
 * Handle a LanguageRuntimeStream message.
 *
 * @param message Message to handle.
 * @returns Resulting cell output items.
 */
function handleRuntimeMessageStream(message: positron.LanguageRuntimeStream): vscode.NotebookCellOutput {
	const cellOutputItems: vscode.NotebookCellOutputItem[] = [];
	switch (message.name) {
		case positron.LanguageRuntimeStreamName.Stdout:
			cellOutputItems.push(vscode.NotebookCellOutputItem.stdout(message.text));
		case positron.LanguageRuntimeStreamName.Stderr:
			cellOutputItems.push(vscode.NotebookCellOutputItem.stderr(message.text));
	}
	return new vscode.NotebookCellOutput(cellOutputItems);
}

/**
 * Handle a LanguageRuntimeError message.
 *
 * @param message Message to handle.
 * @returns Resulting cell output items.
 */
function handleRuntimeMessageError(message: positron.LanguageRuntimeError): vscode.NotebookCellOutput {
	return new vscode.NotebookCellOutput([
		vscode.NotebookCellOutputItem.error({
			name: message.name,
			message: message.message,
			stack: message.traceback.join('\n'),
		})
	]);
}
