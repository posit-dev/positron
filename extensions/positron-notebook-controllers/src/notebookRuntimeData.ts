/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Runtime data associated with a notebook.
 */
export class NotebookRuntimeData implements vscode.Disposable {
	/** The current cell execution order. */
	public executionOrder: number = 0;

	/** The runtime session's state. */
	private _state: positron.RuntimeState = positron.RuntimeState.Uninitialized;

	private disposables: vscode.Disposable[] = [];

	/**
	 * @param session The notebook's language runtime session.
	 */
	constructor(public readonly session: positron.LanguageRuntimeSession) {
		// Dispose the runtime session when this is disposed.
		this.disposables.push(session);

		// Track the runtime session's state.
		this.disposables.push(this.session.onDidChangeRuntimeState((state) => {
			this._state = state;
		}));
	}

	get state(): positron.RuntimeState {
		return this._state;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}
