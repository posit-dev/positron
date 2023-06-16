/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export async function providePackageTasks(_context: vscode.ExtensionContext): Promise<void> {

	const isRPackage = await detectRPackage();
	vscode.commands.executeCommand('setContext', 'isRPackage', isRPackage);

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

async function detectRPackage(): Promise<boolean> {
	if (vscode.workspace.workspaceFolders !== undefined) {
		const folderUri = vscode.workspace.workspaceFolders[0].uri;
		const fileUri = vscode.Uri.joinPath(folderUri, 'DESCRIPTION');
		try {
			const bytes = await vscode.workspace.fs.readFile(fileUri);
			const descriptionText = Buffer.from(bytes).toString('utf8');
			const descriptionLines = descriptionText.split(/(\r?\n)/);
			const descStartsWithPackage = descriptionLines[0].startsWith('Package:');
			const typeLines = descriptionLines.filter(line => line.startsWith('Type:'));
			const typeIsPackage = typeLines.length === 0 || typeLines[0].includes('Package');
			return descStartsWithPackage && typeIsPackage;
		} catch { }
	}
	return false;
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
