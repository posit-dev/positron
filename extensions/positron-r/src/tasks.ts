/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

export class RPackageTaskProvider implements vscode.TaskProvider {

	async provideTasks() {
		const tasks = getRPackageTasks();
		return tasks;
	}

	resolveTask(_task: vscode.Task): vscode.Task | undefined {
		return undefined;
	}

}

export async function providePackageTasks(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.tasks.registerTaskProvider('rPackageTask', new RPackageTaskProvider())
	);
}

export async function getRPackageTasks(): Promise<vscode.Task[]> {
	const runningRuntimes = await positron.runtime.getRunningRuntimes('r');
	// For now, there will be only one running R runtime:
	const runtimePath = runningRuntimes[0].runtimePath;
	const allPackageTasks: PackageTask[] = [
		{ 'name': 'Check R package', 'shellExecution': `${runtimePath}/R -e "devtools::check()"` }
	];
	return allPackageTasks.map(task => new vscode.Task(
		{ type: 'rPackageTask' },
		vscode.TaskScope.Workspace,
		task.name,
		'R',
		new vscode.ShellExecution(task.shellExecution),
		[]
	));
}

type PackageTask = {
	name: string;
	shellExecution: string;
};
