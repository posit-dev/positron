/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function providePackageTasks(_context: vscode.ExtensionContext): void {
	vscode.tasks.registerTaskProvider('rPackageBuild', new RPackageTaskProvider());
}

export class RPackageTaskProvider implements vscode.TaskProvider {

	public provideTasks() {
		return [
			new vscode.Task(
				{ type: 'rPackageBuild' },
				vscode.TaskScope.Workspace,
				'Build package',
				'R',
				new vscode.ShellExecution('R CMD INSTALL --preclean .')
			)
		];
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		return undefined;
	}
}
