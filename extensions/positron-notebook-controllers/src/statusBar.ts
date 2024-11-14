/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { NotebookControllerManager } from './notebookControllerManager';
import { formatCount } from './utils';

export const SHOW_EXECUTION_INFO_SECTION = 'notebook.experimental.showExecutionInfo';

export function registerExecutionInfoStatusBar(
	disposables: vscode.Disposable[], manager: NotebookControllerManager
): void {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

	/** Update the item's visibility based on user configuration. */
	const updateVisibility = () => {
		const showExecutionInfo = vscode.workspace.getConfiguration().get<boolean>(SHOW_EXECUTION_INFO_SECTION);
		if (showExecutionInfo) {
			item.show();
		} else {
			item.hide();
		}
	};

	disposables.push(item);

	// Update the item's text when an execution starts.
	disposables.push(manager.onDidStartExecution((e) => {
		item.text = `Executing ${formatCount(e.cells.length, 'cell')}`;
	}));

	// Update the item's text when an execution ends.
	disposables.push(manager.onDidEndExecution((e) => {
		const durationSeconds = Math.round(e.duration / 1000);
		item.text = `Executed ${formatCount(e.cells.length, 'cell')} ` +
			`in ${formatCount(durationSeconds, 'second')}`;
	}));

	// Update the item's visibility when the configuration changes.
	disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration(SHOW_EXECUTION_INFO_SECTION)) {
			updateVisibility();
		}
	}));

	// Initialize the item's visibility.
	updateVisibility();
}
