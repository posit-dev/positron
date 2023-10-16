/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as positron from 'positron';

/**
 * Wraps a Positron language runtime for a notebook session.
 */
export class NotebookRuntime {

	// Current cell execution order.
	public executionOrder: number = 0;

	// Promise that resolves when the runtime has started.
	private startPromise: Thenable<positron.LanguageRuntimeInfo> | undefined;

	/**
	 * @param runtime Positron language runtime for the notebook.
	 */
	constructor(public runtime: positron.LanguageRuntime) {
	}

	onDidReceiveRuntimeMessage = this.runtime.onDidReceiveRuntimeMessage;

	get metadata(): positron.LanguageRuntimeMetadata {
		return this.runtime.metadata;
	}

	/**
	 * Start the runtime. Calling multiple times will return the same promise.
	 *
	 * @returns Promise that resolves when the runtime has started.
	 */
	async start(): Promise<positron.LanguageRuntimeInfo> {
		if (this.startPromise === undefined) {
			this.startPromise = this.runtime.start();
		}
		return this.startPromise;
	}

	async shutdown(): Promise<void> {
		return this.runtime.shutdown();
	}

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior) {
		return this.runtime.execute(code, id, mode, errorBehavior);
	}

	async interrupt(): Promise<void> {
		return this.runtime.interrupt();
	}

	dispose(): void {
		this.runtime.dispose();
	}
}
