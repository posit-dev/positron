/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RSessionManager } from './session-manager';
import { getPandocPath } from './pandoc';

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

export async function getRPackageTasks(editorFilePath?: string): Promise<vscode.Task[]> {
	if (!RSessionManager.instance.hasLastBinpath()) {
		throw new Error(`No running R runtime to use for R package tasks.`);
	}
	const binpath = RSessionManager.instance.getLastBinpath();
	const taskData = [
		{
			task: 'r.task.packageCheck',
			message: vscode.l10n.t('{taskName}', { taskName: 'Check R package' }),
			rcode: 'devtools::check()',
			package: 'devtools'
		},
		{
			task: 'r.task.packageInstall',
			message: vscode.l10n.t('{taskName}', { taskName: 'Install R package' }),
			rcode: 'pak::local_install(upgrade = FALSE)',
			package: 'pak'
		},
		{
			task: 'r.task.packageTest',
			message: vscode.l10n.t('{taskName}', { taskName: 'Test R package' }),
			rcode: 'devtools::test()',
			package: 'devtools'
		},
		{
			task: 'r.task.rmarkdownRender',
			message: vscode.l10n.t('{taskName}', { taskName: 'Render document with R Markdown' }),
			rcode: `rmarkdown::render("${editorFilePath}")`,
			package: 'rmarkdown'
		}
	];

	// if we have a local copy of Pandoc available, forward it to the R session
	// so that it can be used to render R Markdown documents (etc)
	const env: any = {};
	const pandocPath = getPandocPath();
	if (pandocPath) {
		env['RSTUDIO_PANDOC'] = pandocPath;
	}


	return taskData.map(data => {
		if (data.task === 'r.task.rmarkdownRender') {
			// Use vscode.ProcessExecution for r.task.rmarkdownRender to avoid quoting hell
			return new vscode.Task(
				{ type: 'rPackageTask', task: data.task, pkg: data.package },
				vscode.TaskScope.Workspace,
				data.message,
				'R',
				new vscode.ProcessExecution(
					binpath,
					['-e', data.rcode], // Assuming data.rcode is a string that can be directly used here
					{ env }
				),
				[]
			);
		} else {
			// Use vscode.ShellExecution for all other tasks
			return new vscode.Task(
				{ type: 'rPackageTask', task: data.task, pkg: data.package },
				vscode.TaskScope.Workspace,
				data.message,
				'R',
				// the explicit quoting treatment is necessary to avoid headaches on Windows,
				// with PowerShell
				new vscode.ShellExecution(
					binpath,
					['-e', { value: data.rcode, quoting: vscode.ShellQuoting.Strong }],
					{ env }
				),
				[]
			);
		}
	});
}
