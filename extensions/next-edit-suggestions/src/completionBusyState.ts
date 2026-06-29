/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Tracks in-flight completion requests and reflects the aggregate state in the
 * `nextEditSuggestions.busy` context key, which drives the status bar spinner.
 */
export class CompletionBusyState {
	private readonly inFlight = new Set<Promise<unknown>>();

	async track<T>(operation: () => Promise<T>): Promise<T> {
		const request = operation();
		this.inFlight.add(request);
		this.syncBusyContext();
		try {
			return await request;
		} finally {
			this.inFlight.delete(request);
			this.syncBusyContext();
		}
	}

	private syncBusyContext(): void {
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.busy', this.inFlight.size > 0);
	}
}
