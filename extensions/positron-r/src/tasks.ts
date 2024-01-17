/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RRuntimeManager } from './runtime-manager';

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
	if (!RRuntimeManager.instance.hasLastBinpath()) {
		throw new Error(`No running R runtime to use for R package tasks.`);
	}
	const binpath = RRuntimeManager.instance.getLastBinpath();
	const allPackageTasks: PackageTask[] = [
		{
			'task': 'r.task.packageCheck',
			'message': vscode.l10n.t('{taskName}', { taskName: 'Check R package' }),
			'shellExecution': `"${binpath}" -e "devtools::check()"`,
			'package': 'devtools'
		},
		{
			'task': 'r.task.packageInstall',
			'message': vscode.l10n.t('{taskName}', { taskName: 'Install R package' }),
			'shellExecution': `"${binpath}" -e "pak::local_install(upgrade = FALSE)"`,
			'package': 'pak'
		}
	];
	return allPackageTasks.map(task => new vscode.Task(
		{ type: 'rPackageTask', task: task.task, pkg: task.package },
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
	package?: string;
};
