/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

export function discoverTests(context: vscode.ExtensionContext) {
	const extConfig = vscode.workspace.getConfiguration('positron.r');
	const testingFeatureFlag = extConfig.get<string>('testing.experimental');

	if (!testingFeatureFlag) {
		return [];
	}

	const controller = vscode.tests.createTestController(
		'rPackageTests',
		'R Package Tests'
	);
	context.subscriptions.push(controller);

	controller.resolveHandler = async (test) => {
		if (test) {
			await parseTestsInFile(controller, test);
		} else {
			await discoverTestFilesInWorkspace(controller);
		}
	};

	controller.createRunProfile(
		'Run',
		vscode.TestRunProfileKind.Run,
		(request, token) => runHandler(controller, request, token),
		true
	);
}

async function discoverTestFilesInWorkspace(controller: vscode.TestController) {
	if (!vscode.workspace.workspaceFolders) {
		return []; // handle the case of no open folders
	}

	return Promise.all(
		vscode.workspace.workspaceFolders.map(async workspaceFolder => {
			const pattern = new vscode.RelativePattern(workspaceFolder, 'tests/testthat/test*.{R,r}');
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);

			// When files are created, make sure there's a corresponding "file" node in the tree
			watcher.onDidCreate(uri => getOrCreateFile(controller, uri));
			// When files change, re-parse them
			watcher.onDidChange(uri => parseTestsInFile(controller, getOrCreateFile(controller, uri)));
			// And, finally, delete TestItems for removed files
			watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

			for (const file of await vscode.workspace.findFiles(pattern)) {
				getOrCreateFile(controller, file);
			}

			return watcher;
		})
	);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri): vscode.TestItem {
	const existing = controller.items.get(uri.toString());
	if (existing) {
		return existing;
	}
	const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
	file.canResolveChildren = true;
	controller.items.add(file);
	return file;
}

async function parseTestsInFile(controller: vscode.TestController, file: vscode.TestItem) {
	const uri = file.uri!;
	const matches = await findTests(uri);
	const tests: Map<string, vscode.TestItem> = new Map();

	for (const match of matches) {
		if (match === undefined) {
			continue;
		}
		const testItem = controller.createTestItem(
			`${uri}/${match.testLabel}`,
			match.testLabel,
			uri
		);
		testItem.range = new vscode.Range(match.testStartPosition, match.testEndPosition);
		tests.set(match.testLabel, testItem);
	}

	file.children.replace([...tests.values()]);
	return;
}

async function findTests(uri: vscode.Uri) {
	const fileContents = vscode.workspace.openTextDocument(uri);
	const matches = [];

	// TODO: get the tests out of the file contents
	// This is just dummy example data from my cereal package:
	matches.push({
		testLabel: 'can dispatch',
		testStartPosition: new vscode.Position(0, 0),
		testEndPosition: new vscode.Position(4, 2)
	});
	matches.push({
		testLabel: 'can roundtrip ptype through JSON',
		testStartPosition: new vscode.Position(6, 0),
		testEndPosition: new vscode.Position(22, 2)
	});


	return matches;
}

async function runHandler(controller: vscode.TestController, request: vscode.TestRunRequest, token: vscode.CancellationToken) {
	let run = controller.createTestRun(request);
	const queue: vscode.TestItem[] = [];

	// Loop through all included tests, or all known tests, and add them to our queue
	if (request.include) {
		request.include.forEach(test => queue.push(test));
	} else {
		controller.items.forEach(test => queue.push(test));
	}

	while (queue.length > 0 && !token.isCancellationRequested) {
		const test = queue.pop()!;

		// Skip tests the user asked to exclude
		if (request.exclude?.includes(test)) {
			continue;
		}
		run = await runTest(run, test);
		test.children.forEach(test => queue.push(test));
	}
	run.end();
}

async function runTest(run: vscode.TestRun, test: vscode.TestItem): Promise<vscode.TestRun> {
	if (test.children.size > 0) {
		test.children.forEach(childTest => runTest(run, childTest));
	} else {
		const uri = test.uri!;
		const document = await vscode.workspace.openTextDocument(uri);
		const source = document.getText();
		const range = test.range!;
		const startIndex = document.offsetAt(range.start);
		const endIndex = document.offsetAt(range.end);
		const testSource = source.slice(startIndex, endIndex);
		const start = Date.now();
		try {
			positron.runtime.executeCode('r', testSource, true);
			run.passed(test, Date.now() - start);
		} catch (error) {
			run.failed(test, new vscode.TestMessage(String(error)), Date.now() - start);
		}
	}
	return (run);
}
