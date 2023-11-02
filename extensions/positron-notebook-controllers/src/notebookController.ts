/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { NotebookRuntime } from './notebookRuntime';
import { trace } from './logging';
import { delay, noop } from './util';

/**
 * Wraps a vscode.NotebookController for a specific language, and manages a NotebookRuntime
 * for each vscode.NotebookDocument that uses this controller.
 */
export class NotebookController implements vscode.Disposable {

	private disposables: vscode.Disposable[] = [];

	// Wrapped VSCode notebook controller.
	private controller: vscode.NotebookController;

	// Notebook runtimes keyed by notebook.
	private notebookRuntimes: Map<vscode.NotebookDocument, NotebookRuntime> = new Map();

	// Incremented for each cell we create to give it unique ID.
	private static CELL_COUNTER = 0;

	/**
	 * @param languageId The language ID for which this controller is responsible.
	 */
	constructor(private languageId: string) {
		// Create a VSCode notebook controller for this language.
		this.controller = vscode.notebooks.createNotebookController(
			`positron-${languageId}`,
			// The 'jupyter-notebook' notebook type is contributed via the built-in extension
			// extensions/ipynb. Registering our notebook controllers with the same type ensures
			// that they show up in the notebook UI's kernel picker for .ipynb files.
			'jupyter-notebook',
			// Display name in the notebook UI's kernel picker.
			// TODO: We should use the runtimeName of the preferred runtime for this language, as
			// well as update the controller name when the preferred runtime changes.
			`${languageId[0].toUpperCase()}${languageId.slice(1)}`,
		);
		this.controller.supportedLanguages = [this.languageId];
		this.controller.supportsExecutionOrder = true;
		this.controller.executeHandler = this.executeCells.bind(this);

		this.disposables.push(this.controller);

		// Displayed on the right of the kernel in the notebook UI's kernel picker.
		// TODO: We should set the description to the runtimePath of the preferred runtime for this
		// language.
		// this.controller.description = 'Positron Runtime Notebook Controller';

		this.disposables.push(vscode.workspace.onDidCloseNotebookDocument(async (notebook) => {
			// Wait a few seconds before shutting down the runtime. If this was reached via a window
			// reload, we want to give the runtime a chance to reconnect.
			await delay(3000);
			this.shutdownRuntime(notebook);
		}));

		this.disposables.push(this.controller.onDidChangeSelectedNotebooks(async (e) => {
			await this.shutdownRuntime(e.notebook);

			// Has this controller been selected for a notebook?
			if (e.selected) {
				// Note that this is also reached when a notebook is opened, if this controller was
				// already selected.

				// Get the preferred runtime for this language.
				const preferredRuntime = await positron.runtime.getPreferredRuntime(this.languageId);

				// Create the updated metadata for the notebook's runtime.
				const digest = crypto.createHash('sha256');
				digest.update(preferredRuntime.metadata.runtimeId);
				digest.update(e.notebook.uri.path);
				const runtimeId = digest.digest('hex').substring(0, 32);
				const runtimeName = preferredRuntime.metadata.runtimeName + ` (${e.notebook.uri.path})`;
				const metadata = { ...preferredRuntime.metadata, runtimeId, runtimeName };

				// Clone and start the runtime.
				const runtime = preferredRuntime.clone(metadata, e.notebook);
				const notebookRuntime = new NotebookRuntime(runtime);
				this.notebookRuntimes.set(e.notebook, notebookRuntime);
				await notebookRuntime.start();
				trace(`Started runtime ${runtimeName} for notebook ${e.notebook.uri.path}`);
			}
		}));
	}

	/**
	 * Notebook controller execute handler.
	 *
	 * @param cells Cells to execute.
	 * @param _notebook Notebook containing the cells.
	 * @param _controller Notebook controller.
	 */
	private async executeCells(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController) {
		for (const cell of cells) {
			await this.executeCell(cell);
		}
	}

	/**
	 * Shutdown the runtime for a notebook.
	 *
	 * @param notebook Notebook whose runtime to shutdown.
	 */
	private async shutdownRuntime(notebook: vscode.NotebookDocument): Promise<void> {
		const runtime = this.notebookRuntimes.get(notebook);
		if (runtime) {
			await runtime.shutdown();
			runtime.dispose();
			this.notebookRuntimes.delete(notebook);
			trace(`Shutdown runtime ${runtime.metadata.runtimeName} for notebook ${notebook.uri.path}`);
		}
	}

	/**
	 * Execute a notebook cell.
	 *
	 * @param cell Cell to execute.
	 */
	private async executeCell(cell: vscode.NotebookCell): Promise<void> {
		// Get the cell's notebook runtime.
		const runtime = this.notebookRuntimes.get(cell.notebook);
		if (!runtime) {
			throw new Error(`Tried to execute cell in notebook without a runtime: ${cell.notebook.uri.path}`);
		}

		// Create a cell execution.
		const currentExecution = this.controller.createNotebookCellExecution(cell);

		// Increment the execution order.
		currentExecution.executionOrder = ++runtime.executionOrder;

		// If the cell's stop button is pressed, interrupt the runtime.
		currentExecution.token.onCancellationRequested(runtime.interrupt.bind(runtime));

		// Start the execution timer.
		// TODO: We should only start the execution timer when the runtime is actually executing
		// the cell. We could maintain a queue of executions to handle this.
		currentExecution.start(Date.now());

		// Clear any existing outputs.
		currentExecution.clearOutput().then(noop, noop);

		// Ensure that the notebook runtime has started before trying to execute code.
		if (runtime.getState() !== positron.RuntimeState.Idle) {
			try {
				// Await a promise that resolves when the runtime enters the 'idle' state.
				await new Promise<void>((resolve, reject) => {
					// Set a timer to reject the promise if we don't observe an 'idle' runtime state
					// within 5 seconds.
					const timeout = setTimeout(() => {
						disposable.dispose();

						reject(`Timed out waiting 5 seconds for kernel to start.`);
					}, 5000);

					// Resolve the promise when the runtime enters the 'idle' state.
					const disposable = runtime.onDidChangeRuntimeState((state) => {
						if (state === positron.RuntimeState.Idle) {
							clearTimeout(timeout);
							disposable.dispose();
							resolve();
						}
					});
				});
			} catch (e) {
				// Display the error as a cell output.
				currentExecution.appendOutput(new vscode.NotebookCellOutput([
					vscode.NotebookCellOutputItem.error({
						name: 'Runtime Error',
						message: e.toString(),
						stack: '',
					})
				])).then(noop, noop);

				// End the execution as unsuccessful.
				currentExecution.end(false, Date.now());

				// Exit early.
				return;
			}
		}

		// Create a promise that resolves when the cell execution is complete i.e. when the runtime
		// receives an error or status idle reply message.
		const cellId = `positron-notebook-cell-${NotebookController.CELL_COUNTER++}`;
		const promise = new Promise<void>((resolve, _reject) => {
			// Update the cell execution using received runtime messages.
			const handler = runtime.onDidReceiveRuntimeMessage(message => {
				// Track whether the cell execution was successful.
				let success: boolean | undefined;

				// Is the message a reply to the cell we're executing?
				if (message.parent_id === cellId) {

					// Handle the message, and store any resulting outputs.
					let cellOutputItems: vscode.NotebookCellOutputItem[] = [];
					switch (message.type) {
						case positron.LanguageRuntimeMessageType.Output:
							cellOutputItems = handleRuntimeMessageOutput(message as positron.LanguageRuntimeOutput);
							break;
						case positron.LanguageRuntimeMessageType.Stream:
							cellOutputItems = handleRuntimeMessageStream(message as positron.LanguageRuntimeStream);
							break;
						case positron.LanguageRuntimeMessageType.Error:
							cellOutputItems = handleRuntimeMessageError(message as positron.LanguageRuntimeError);
							success = false;
							break;
						case positron.LanguageRuntimeMessageType.State:
							if ((message as positron.LanguageRuntimeState).state === positron.RuntimeOnlineState.Idle) {
								success = true;
							}
							break;
					}

					// Append any resulting outputs to the cell execution.
					if (cellOutputItems.length > 0) {
						currentExecution.appendOutput(new vscode.NotebookCellOutput(cellOutputItems)).then(noop, noop);
					}
				}

				// If a success code was set, end the execution, dispose the handler, and resolve the promise.
				if (success !== undefined) {
					currentExecution.end(success, Date.now());
					handler.dispose();
					resolve();
				}
			});
		});

		// Execute the cell.
		runtime.execute(
			cell.document.getText(),
			cellId,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Stop
		);

		return promise;
	}

	public async dispose() {
		this.disposables.forEach(d => d.dispose());
	}
}

/**
 * Handle a LanguageRuntimeOutput message.
 *
 * @param message Message to handle.
 * @returns Resulting cell output items.
 */
function handleRuntimeMessageOutput(message: positron.LanguageRuntimeOutput): vscode.NotebookCellOutputItem[] {
	const cellOutputItems: vscode.NotebookCellOutputItem[] = [];
	const mimeTypes = Object.keys(message.data);
	mimeTypes.map(mimeType => {
		const data = message.data[mimeType];
		if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
			cellOutputItems.push(new vscode.NotebookCellOutputItem(Buffer.from(data, 'base64'), mimeType));
		} else {
			cellOutputItems.push(vscode.NotebookCellOutputItem.text(data, mimeType));
		}
	});
	return cellOutputItems;
}

/**
 * Handle a LanguageRuntimeStream message.
 *
 * @param message Message to handle.
 * @returns Resulting cell output items.
 */
function handleRuntimeMessageStream(message: positron.LanguageRuntimeStream): vscode.NotebookCellOutputItem[] {
	switch (message.name) {
		case positron.LanguageRuntimeStreamName.Stdout:
			return [vscode.NotebookCellOutputItem.stdout(message.text)];
		case positron.LanguageRuntimeStreamName.Stderr:
			return [vscode.NotebookCellOutputItem.stderr(message.text)];
	}
}

/**
 * Handle a LanguageRuntimeError message.
 *
 * @param message Message to handle.
 * @returns Resulting cell output items.
 */
function handleRuntimeMessageError(message: positron.LanguageRuntimeError): vscode.NotebookCellOutputItem[] {
	return [
		vscode.NotebookCellOutputItem.error({
			name: message.name,
			message: message.message,
			stack: message.traceback.join('\n'),
		})
	];
}
