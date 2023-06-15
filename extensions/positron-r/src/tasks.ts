/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function providePackageTasks(_context: vscode.ExtensionContext): void {

	const allPackageTasks: PackageTask[] = [
		{ 'type': 'rPackageLoad', 'name': 'Load package', 'shellExecution': 'R -e "devtools::load_all()"' },
		{ 'type': 'rPackageBuild', 'name': 'Build package', 'shellExecution': 'R -e "devtools::build()"' },
		{ 'type': 'rPackageTest', 'name': 'Test package', 'shellExecution': 'R -e "devtools::test()"' },
		{ 'type': 'rPackageCheck', 'name': 'Check package', 'shellExecution': 'R -e "devtools::check()"' },
	];

	for (const packageTask of allPackageTasks) {
		registerRPackageTaskProvider(packageTask);
	}

}

function registerRPackageTaskProvider(packageTask: PackageTask): vscode.Disposable {
	const task = rPackageTask(packageTask);
	const taskProvider = vscode.tasks.registerTaskProvider(packageTask.type, {
		provideTasks: () => {
			return [task];
		},
		resolveTask(_task: vscode.Task): vscode.Task | undefined {
			return undefined;
		}
	});
	return (taskProvider);
}

function rPackageTask(packageTask: PackageTask): vscode.Task {
	return new vscode.Task(
		{ type: packageTask.type },
		vscode.TaskScope.Workspace,
		packageTask.name,
		'R',
		new vscode.ShellExecution(packageTask.shellExecution),
		[]
	);
}

type PackageTask = {
	type: string;
	name: string;
	shellExecution: string;
};
