/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function providePackageTasks(_context: vscode.ExtensionContext): void {
	registerRPackageTaskProvider('rPackageLoad', 'Load package', 'R -e "devtools::load_all()"');
	registerRPackageTaskProvider('rPackageBuild', 'Build package', 'R -e "devtools::build()"');
	registerRPackageTaskProvider('rPackageTest', 'Test package', 'R -e "devtools::test()"');
	registerRPackageTaskProvider('rPackageCheck', 'Check package', 'R -e "devtools::check()"');
}

function registerRPackageTaskProvider(type: string, name: string, shellExecution: string): vscode.Disposable {
	const task = rPackageTask(type, name, shellExecution);
	const taskProvider = vscode.tasks.registerTaskProvider(type, {
		provideTasks: () => {
			return [task];
		},
		resolveTask(_task: vscode.Task): vscode.Task | undefined {
			return undefined;
		}
	});
	return (taskProvider);
}

function rPackageTask(type: string, name: string, shellExecution: string): vscode.Task {
	return new vscode.Task(
		{ type: type },
		vscode.TaskScope.Workspace,
		name,
		'R',
		new vscode.ShellExecution(shellExecution)
	);
}
