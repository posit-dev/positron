/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getActiveDocumentManager } from './documentManager';

export function registerCommands(disposables: vscode.Disposable[]) {
	disposables.push(
		// Movement
		vscode.commands.registerCommand('positron.goToPreviousCell', (line?: number) => {
			getActiveDocumentManager()?.goToPreviousCell(line);
		}),

		vscode.commands.registerCommand('positron.goToNextCell', (line?: number) => {
			getActiveDocumentManager()?.goToNextCell(line);
		}),

		// Insert cell
		vscode.commands.registerCommand('positron.insertCodeCell', async (line?: number) => {
			await getActiveDocumentManager()?.insertCodeCell(line);
		}),

		// Run cells
		vscode.commands.registerCommand('positron.runAllCells', () => {
			getActiveDocumentManager()?.runAllCells();
		}),

		vscode.commands.registerCommand('positron.runCellsAbove', (line?: number) => {
			getActiveDocumentManager()?.runCellsAbove(line);
		}),

		vscode.commands.registerCommand('positron.runCurrentAndBelow', (line?: number) => {
			getActiveDocumentManager()?.runCurrentAndBelow(line);
		}),

		vscode.commands.registerCommand('positron.runCellsBelow', (line?: number) => {
			getActiveDocumentManager()?.runCellsBelow(line);
		}),

		vscode.commands.registerCommand('positron.runCurrentAdvance', (line?: number) => {
			getActiveDocumentManager()?.runCurrentAdvance(line);
		}),

		vscode.commands.registerCommand('positron.runCurrentCell', (line?: number) => {
			getActiveDocumentManager()?.runCurrentCell(line);
		}),

		vscode.commands.registerCommand('positron.runNextCell', (line?: number) => {
			getActiveDocumentManager()?.runNextCell(line);
		}),

		vscode.commands.registerCommand('positron.runPreviousCell', (line?: number) => {
			getActiveDocumentManager()?.runPreviousCell(line);
		}),

	);
}
