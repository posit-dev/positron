/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CellManager } from './cellManager';

export function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron.goToPreviousCell', (line?: number) => {
			CellManager.fromActiveTextEditor()?.goToPreviousCell(line);
		}),

		vscode.commands.registerCommand('positron.goToNextCell', (line?: number) => {
			CellManager.fromActiveTextEditor()?.goToNextCell(line);
		}),

		vscode.commands.registerCommand('positron.insertCodeCell', async (line?: number) => {
			await CellManager.fromActiveTextEditor()?.insertCodeCell(line);
		}),

		vscode.commands.registerCommand('positron.runAllCells', () => {
			CellManager.fromActiveTextEditor()?.runAllCells();
		}),

		vscode.commands.registerCommand('positron.runCellsAbove', (line?: number) => {
			CellManager.fromActiveTextEditor()?.runCellsAbove(line);
		}),

		vscode.commands.registerCommand('positron.runCellsBelow', (line?: number) => {
			CellManager.fromActiveTextEditor()?.runCellsBelow(line);
		}),

		vscode.commands.registerCommand('positron.runCurrentAdvance', (line?: number) => {
			CellManager.fromActiveTextEditor()?.runCurrentAdvance(line);
		}),

		vscode.commands.registerCommand('positron.runCurrentCell', (line?: number) => {
			CellManager.fromActiveTextEditor()?.runCurrentCell(line);
		}),

		vscode.commands.registerCommand('positron.runNextCell', (line?: number) => {
			CellManager.fromActiveTextEditor()?.runNextCell(line);
		}),

		vscode.commands.registerCommand('positron.runPreviousCell', (line?: number) => {
			CellManager.fromActiveTextEditor()?.runPreviousCell(line);
		}),


	);
}
