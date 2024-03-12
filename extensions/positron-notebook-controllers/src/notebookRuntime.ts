/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Wraps a Positron language runtime for a notebook session.
 */
export class NotebookRuntime implements vscode.Disposable {

	private disposables: vscode.Disposable[] = [];

	// Current cell execution order.
	public executionOrder: number = 0;

	// The language runtime's state.
	private state: positron.RuntimeState = positron.RuntimeState.Uninitialized;

	/**
	 * @param runtime Positron language runtime for the notebook.
	 */
	constructor(private readonly runtime: positron.LanguageRuntimeSession) {
		this.disposables.push(runtime);

		// Track the language runtime's state.
		this.disposables.push(this.runtime.onDidChangeRuntimeState((state) => {
			this.state = state;
		}));
	}

	onDidReceiveRuntimeMessage = this.runtime.onDidReceiveRuntimeMessage;
	onDidChangeRuntimeState = this.runtime.onDidChangeRuntimeState;

	get metadata(): positron.LanguageRuntimeMetadata {
		return this.runtime.runtimeMetadata;
	}

	getState(): positron.RuntimeState {
		return this.state;
	}

	/**
	 * Start the runtime. Calling multiple times will return the same promise.
	 *
	 * @returns Promise that resolves when the runtime has started.
	 */
	async start(): Promise<positron.LanguageRuntimeInfo> {
		return this.runtime.start();
	}

	async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
		return this.runtime.shutdown(exitReason);
	}

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior) {
		return this.runtime.execute(code, id, mode, errorBehavior);
	}

	async interrupt(): Promise<void> {
		return this.runtime.interrupt();
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}
