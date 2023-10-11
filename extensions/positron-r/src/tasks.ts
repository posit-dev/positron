/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { lastRuntimePath } from './runtime';

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
	if (!lastRuntimePath) {
		throw new Error(`No running R runtime to provide R package tasks.`);
	}
	const allPackageTasks: PackageTask[] = [
		{
			'task': 'r.task.packageCheck',
			'message': vscode.l10n.t('{taskName}', { taskName: 'Check R package' }),
			'shellExecution': `${lastRuntimePath}/R -e "devtools::check()"`
		},
		{
			'task': 'r.task.packageInstall',
			'message': vscode.l10n.t('{taskName}', { taskName: 'Install R package' }),
			'shellExecution': `${lastRuntimePath}/R -e "devtools::install()"`
		}
	];
	return allPackageTasks.map(task => new vscode.Task(
		{ type: 'rPackageTask', task: task.task },
		vscode.TaskScope.Workspace,
		task.message,
		'R',
		new vscode.ShellExecution(task.shellExecution),
		[]
	));
}

type PackageTask = {
	task: string;
	message: string;
	shellExecution: string;
};
