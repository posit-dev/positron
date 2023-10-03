/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
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
		{ 'name': 'Check R package', 'shellExecution': `${lastRuntimePath}/R -e "devtools::check()"` }
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
