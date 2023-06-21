/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

export async function providePackageTasks(_context: vscode.ExtensionContext): Promise<void> {

	const isRPackage = await detectRPackage();
	vscode.commands.executeCommand('setContext', 'isRPackage', isRPackage);

	const allPackageTasks: PackageTask[] = [
		{ 'type': 'rPackageLoad', 'name': 'Load package', 'code': 'devtools::load_all()' },
		{ 'type': 'rPackageBuild', 'name': 'Build package', 'code': 'devtools::build()' },
		{ 'type': 'rPackageTest', 'name': 'Test package', 'code': 'devtools::test()' },
		{ 'type': 'rPackageCheck', 'name': 'Check package', 'code': 'devtools::check()' },
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

class RTaskConsole implements vscode.Pseudoterminal {

	private writeEmitter = new vscode.EventEmitter<string>();
	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	constructor(private code: string) { }
	open(): void {
		positron.runtime.executeCode('r', this.code, true);
	}
	close(): void { }
}

function rPackageTask(packageTask: PackageTask): vscode.Task {
	return new vscode.Task(
		{ type: packageTask.type },
		vscode.TaskScope.Workspace,
		packageTask.name,
		'R',
		new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
			return new RTaskConsole(packageTask.code);
		}),
		[]
	);
}

type PackageTask = {
	type: string;
	name: string;
	code: string;
};
