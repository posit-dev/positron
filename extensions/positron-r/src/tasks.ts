/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
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
		let exec: vscode.ProcessExecution | vscode.ShellExecution;
		if (data.task === 'r.task.rmarkdownRender' && os.platform() === 'win32') {
			// Using vscode.ProcessExecution gets around some hairy quoting issues on Windows,
			// specifically encountered with PowerShell.
			// https://github.com/posit-dev/positron/issues/3816
			// We don't know of specific problems around not using a shell (for example, env vars
			// appear to be inherited by ProcessExecution), but we're still scoping this narrowly
			// out of caution.
			exec = new vscode.ProcessExecution(
				binpath,
				['--quiet --no-restore --no-save -e', data.rcode],
				{ env }
			);
		} else {
			// The explicit quoting treatment here is also motivated by PowerShell, so make sure to
			// test any changes on Windows.
			exec = new vscode.ShellExecution(
				binpath,
				['--quiet --no-restore --no-save -e', { value: data.rcode, quoting: vscode.ShellQuoting.Strong }],
				{ env }
			);
		}

		return new vscode.Task(
			{ type: 'rPackageTask', task: data.task, pkg: data.package },
			vscode.TaskScope.Workspace,
			data.message,
			'R',
			exec,
			[]
		);
	});
}
